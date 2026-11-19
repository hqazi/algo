//! Rust harness runtime (SPEC §6.4, DECISIONS D-29): reads the tests from
//! stdin, calls the generated `call` for each one, and writes one result
//! record per test. Value converters for every neutral type except trees and
//! linked lists (those are generated in `nodes.rs`, for the node's value type).
//!
//! Copied unchanged into every Rust harness project; `main.rs` is generated.

#![allow(dead_code)]

use crate::json::{self, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::panic::{self, AssertUnwindSafe};
use std::sync::Mutex;
use std::time::Instant;

pub type R<T> = Result<T, String>;

/// Most nodes a returned tree or list may have (a cycle never ends).
pub const NODE_LIMIT: usize = 10_000_000;
/// Stack for the thread that runs the solution: deep recursion is common.
const STACK_BYTES: usize = 512 * 1024 * 1024;
const RECORD_MARK: char = '\u{1e}';

/// Why `call` did not produce a value.
pub enum CallError {
    /// A test input did not convert: a harness or content bug, not the solution's.
    Input(String),
    /// The return value could not be turned into JSON (time in ms).
    Output(String, f64),
}

pub type Call = fn(&[Value]) -> Result<(Value, f64), CallError>;

// ------------------------------------------------------------------ input

fn expected<T>(what: &str, v: &Value) -> R<T> {
    Err(format!("expected {}, got {}", what, v.describe()))
}

pub fn de_int(v: &Value) -> R<i64> {
    match v {
        Value::Int(n) => Ok(*n),
        Value::Float(f) if f.fract() == 0.0 && f.abs() < 9.2e18 => Ok(*f as i64),
        _ => expected("an integer", v),
    }
}

pub fn de_float(v: &Value) -> R<f64> {
    match v {
        Value::Int(n) => Ok(*n as f64),
        Value::Float(f) => Ok(*f),
        _ => expected("a number", v),
    }
}

pub fn de_bool(v: &Value) -> R<bool> {
    match v {
        Value::Bool(b) => Ok(*b),
        _ => expected("a boolean", v),
    }
}

pub fn de_string(v: &Value) -> R<String> {
    match v {
        Value::Str(s) => Ok(s.clone()),
        _ => expected("a string", v),
    }
}

pub fn de_char(v: &Value) -> R<char> {
    if let Value::Str(s) = v {
        let mut it = s.chars();
        if let (Some(c), None) = (it.next(), it.next()) {
            return Ok(c);
        }
    }
    expected("a one-character string", v)
}

pub fn de_list<T>(v: &Value, f: impl Fn(&Value) -> R<T>) -> R<Vec<T>> {
    match v {
        Value::Arr(items) => items.iter().map(|x| f(x)).collect(),
        _ => expected("an array", v),
    }
}

/// The items of a tuple, checked for length.
pub fn de_items(v: &Value, n: usize) -> R<&[Value]> {
    match v {
        Value::Arr(items) if items.len() == n => Ok(items),
        _ => Err(format!("expected an array of {} items, got {}", n, v.describe())),
    }
}

pub fn de_map_str<T>(v: &Value, f: impl Fn(&Value) -> R<T>) -> R<HashMap<String, T>> {
    match v {
        Value::Obj(items) => items.iter().map(|(k, x)| Ok((k.clone(), f(x)?))).collect(),
        _ => expected("an object", v),
    }
}

pub fn de_map_int<T>(v: &Value, f: impl Fn(&Value) -> R<T>) -> R<HashMap<i64, T>> {
    match v {
        Value::Obj(items) => items
            .iter()
            .map(|(k, x)| {
                let key = k.parse::<i64>().map_err(|_| format!("bad integer key {:?}", k))?;
                Ok((key, f(x)?))
            })
            .collect(),
        _ => expected("an object", v),
    }
}

pub fn de_opt<T>(v: &Value, f: impl Fn(&Value) -> R<T>) -> R<Option<T>> {
    match v {
        Value::Null => Ok(None),
        _ => f(v).map(Some),
    }
}

/// A tree's level-order array: values with `null` gaps.
pub fn de_level_order<T>(v: &Value, f: impl Fn(&Value) -> R<T>) -> R<Vec<Option<T>>> {
    de_list(v, |x| de_opt(x, &f))
}

// ----------------------------------------------------------------- output

pub fn ser_int(x: &i64) -> R<Value> {
    Ok(Value::Int(*x))
}

pub fn ser_float(x: &f64) -> R<Value> {
    Ok(Value::Float(*x))
}

pub fn ser_bool(x: &bool) -> R<Value> {
    Ok(Value::Bool(*x))
}

pub fn ser_string(x: &String) -> R<Value> {
    Ok(Value::Str(x.clone()))
}

pub fn ser_char(x: &char) -> R<Value> {
    Ok(Value::Str(x.to_string()))
}

pub fn ser_list<T>(x: &[T], f: impl Fn(&T) -> R<Value>) -> R<Value> {
    x.iter().map(|i| f(i)).collect::<R<Vec<_>>>().map(Value::Arr)
}

pub fn ser_map_str<T>(x: &HashMap<String, T>, f: impl Fn(&T) -> R<Value>) -> R<Value> {
    let mut items = x.iter().map(|(k, v)| Ok((k.clone(), f(v)?))).collect::<R<Vec<_>>>()?;
    items.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Value::Obj(items))
}

pub fn ser_map_int<T>(x: &HashMap<i64, T>, f: impl Fn(&T) -> R<Value>) -> R<Value> {
    let mut keys: Vec<&i64> = x.keys().collect();
    keys.sort();
    keys.into_iter()
        .map(|k| Ok((k.to_string(), f(&x[k])?)))
        .collect::<R<Vec<_>>>()
        .map(Value::Obj)
}

pub fn ser_opt<T>(x: &Option<T>, f: impl Fn(&T) -> R<Value>) -> R<Value> {
    match x {
        None => Ok(Value::Null),
        Some(v) => f(v),
    }
}

// ---------------------------------------------------------------- running

static PANIC_AT: Mutex<Option<(String, u32)>> = Mutex::new(None);

/// Run the harness: `names` are the parameters in order, `call` converts and
/// calls the solution. Exits 0 when every test produced a record.
pub fn main(names: &'static [&'static str], call: Call) {
    let worker = std::thread::Builder::new()
        .stack_size(STACK_BYTES)
        .spawn(move || run(names, call))
        .expect("could not start the solution thread");
    let code = worker.join().unwrap_or(3);
    std::process::exit(code);
}

fn run(names: &[&str], call: Call) -> i32 {
    let mut text = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut text) {
        eprintln!("harness: cannot read stdin: {}", e);
        return 2;
    }
    let values = match json::parse_all(&text) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("harness: {}", e);
            return 2;
        }
    };
    let nonce = match values.first().and_then(|h| h.get("nonce")) {
        Some(Value::Str(s)) => s.clone(),
        _ => {
            eprintln!("harness: the first line must be {{\"nonce\": \"...\"}}");
            return 2;
        }
    };

    panic::set_hook(Box::new(|info| {
        let at = info.location().map(|l| (l.file().to_string(), l.line()));
        *PANIC_AT.lock().unwrap_or_else(|e| e.into_inner()) = at;
    }));

    for input in &values[1..] {
        let mut args = Vec::with_capacity(names.len());
        for name in names {
            match input.get(name) {
                Some(v) => args.push(v.clone()),
                None => {
                    emit(&nonce, &fatal(&format!("test input has no \"{}\"", name)));
                    return 2;
                }
            }
        }
        *PANIC_AT.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let start = Instant::now();
        let outcome = panic::catch_unwind(AssertUnwindSafe(|| call(&args)));
        let record = match outcome {
            Ok(Ok((actual, ms))) => {
                let mut r = String::from("{\"status\":\"ok\",\"actual\":");
                json::write(&actual, &mut r);
                r.push_str(&format!(",\"time_ms\":{}}}", round_ms(ms)));
                r
            }
            Ok(Err(CallError::Input(message))) => {
                emit(&nonce, &fatal(&format!("cannot convert a test input: {}", message)));
                return 2;
            }
            Ok(Err(CallError::Output(message, ms))) => error_record("output", &message, None, ms),
            Err(payload) => {
                let message = if let Some(s) = payload.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = payload.downcast_ref::<String>() {
                    s.clone()
                } else {
                    String::from("panicked")
                };
                let at = PANIC_AT.lock().unwrap_or_else(|e| e.into_inner()).take();
                let line = at.filter(|(f, _)| f.ends_with("solution.rs")).map(|(_, l)| l);
                let ms = start.elapsed().as_secs_f64() * 1000.0;
                error_record("panic", &message, line, ms)
            }
        };
        emit(&nonce, &record);
    }
    0
}

fn round_ms(ms: f64) -> f64 {
    (ms * 1000.0).round() / 1000.0
}

fn error_record(kind: &str, message: &str, line: Option<u32>, ms: f64) -> String {
    let mut r = String::from("{\"status\":\"error\",\"error_type\":");
    json::write_str(kind, &mut r);
    r.push_str(",\"message\":");
    json::write_str(message, &mut r);
    if let Some(l) = line {
        r.push_str(&format!(",\"line\":{}", l));
    }
    r.push_str(&format!(",\"time_ms\":{}}}", round_ms(ms)));
    r
}

fn fatal(message: &str) -> String {
    let mut r = String::from("{\"status\":\"fatal\",\"message\":");
    json::write_str(message, &mut r);
    r.push('}');
    r
}

fn emit(nonce: &str, record: &str) {
    let mut out = std::io::stdout().lock();
    let _ = write!(out, "{}{} {}\n", RECORD_MARK, nonce, record);
    let _ = out.flush();
}
