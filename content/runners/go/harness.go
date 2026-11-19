// Go harness runtime (SPEC §6.4, DECISIONS D-29): reads the tests from stdin,
// calls the generated harnessCallSolution for each one, and writes one result
// record per test. Value converters for every neutral type except trees,
// linked lists and tuples (generated in glue.go for this signature).
//
// Copied unchanged into every Go harness project.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// harnessNodeLimit is the most nodes a returned tree or list may have (a cycle never ends).
const harnessNodeLimit = 10_000_000

// harnessInputError: a test input did not convert (a harness or content bug).
type harnessInputError struct{ msg string }

func (e harnessInputError) Error() string { return e.msg }

// harnessOutputError: the return value could not be turned into JSON.
type harnessOutputError struct{ msg string }

func (e harnessOutputError) Error() string { return e.msg }

type harnessCall func(args []any) (actual any, ms float64, err error)

// ------------------------------------------------------------------ input

func harnessDescribe(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "a boolean"
	case json.Number:
		return "a number"
	case string:
		return "a string"
	case []any:
		return "an array"
	case map[string]any:
		return "an object"
	}
	return fmt.Sprintf("%T", v)
}

func harnessExpected(what string, v any) error {
	return fmt.Errorf("expected %s, got %s", what, harnessDescribe(v))
}

func harnessInt(v any) (int, error) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, harnessExpected("an integer", v)
	}
	if i, err := strconv.ParseInt(string(n), 10, 64); err == nil {
		return int(i), nil
	}
	if f, err := n.Float64(); err == nil && f == math.Trunc(f) && math.Abs(f) < 9.2e18 {
		return int(f), nil
	}
	return 0, harnessExpected("an integer", v)
}

func harnessFloat(v any) (float64, error) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, harnessExpected("a number", v)
	}
	return n.Float64()
}

func harnessBool(v any) (bool, error) {
	b, ok := v.(bool)
	if !ok {
		return false, harnessExpected("a boolean", v)
	}
	return b, nil
}

func harnessString(v any) (string, error) {
	s, ok := v.(string)
	if !ok {
		return "", harnessExpected("a string", v)
	}
	return s, nil
}

func harnessChar(v any) (rune, error) {
	s, ok := v.(string)
	if !ok || utf8.RuneCountInString(s) != 1 {
		return 0, harnessExpected("a one-character string", v)
	}
	r, _ := utf8.DecodeRuneInString(s)
	return r, nil
}

func harnessList[T any](f func(any) (T, error)) func(any) ([]T, error) {
	return func(v any) ([]T, error) {
		items, ok := v.([]any)
		if !ok {
			return nil, harnessExpected("an array", v)
		}
		out := make([]T, len(items))
		for i, item := range items {
			x, err := f(item)
			if err != nil {
				return nil, err
			}
			out[i] = x
		}
		return out, nil
	}
}

// harnessItems returns a tuple's items, checked for length.
func harnessItems(v any, n int) ([]any, error) {
	items, ok := v.([]any)
	if !ok || len(items) != n {
		return nil, fmt.Errorf("expected an array of %d items, got %s", n, harnessDescribe(v))
	}
	return items, nil
}

func harnessMapStr[T any](f func(any) (T, error)) func(any) (map[string]T, error) {
	return func(v any) (map[string]T, error) {
		obj, ok := v.(map[string]any)
		if !ok {
			return nil, harnessExpected("an object", v)
		}
		out := make(map[string]T, len(obj))
		for k, item := range obj {
			x, err := f(item)
			if err != nil {
				return nil, err
			}
			out[k] = x
		}
		return out, nil
	}
}

func harnessMapInt[T any](f func(any) (T, error)) func(any) (map[int]T, error) {
	return func(v any) (map[int]T, error) {
		obj, ok := v.(map[string]any)
		if !ok {
			return nil, harnessExpected("an object", v)
		}
		out := make(map[int]T, len(obj))
		for k, item := range obj {
			key, err := strconv.ParseInt(k, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("bad integer key %q", k)
			}
			x, err := f(item)
			if err != nil {
				return nil, err
			}
			out[int(key)] = x
		}
		return out, nil
	}
}

func harnessOpt[T any](f func(any) (T, error)) func(any) (*T, error) {
	return func(v any) (*T, error) {
		if v == nil {
			return nil, nil
		}
		x, err := f(v)
		if err != nil {
			return nil, err
		}
		return &x, nil
	}
}

// harnessLevelOrder reads a tree's level-order array: values with null gaps.
func harnessLevelOrder[T any](f func(any) (T, error)) func(any) ([]*T, error) {
	return harnessList(harnessOpt(f))
}

// ----------------------------------------------------------------- output

func harnessOutInt(x int) (any, error)       { return x, nil }
func harnessOutBool(x bool) (any, error)     { return x, nil }
func harnessOutString(x string) (any, error) { return x, nil }
func harnessOutChar(x rune) (any, error)     { return string(x), nil }

// harnessOutFloat writes non-finite floats as the strings nan, inf and -inf,
// as the Python harness does.
func harnessOutFloat(x float64) (any, error) {
	switch {
	case math.IsNaN(x):
		return "nan", nil
	case math.IsInf(x, 1):
		return "inf", nil
	case math.IsInf(x, -1):
		return "-inf", nil
	}
	return x, nil
}

func harnessOutList[T any](f func(T) (any, error)) func([]T) (any, error) {
	return func(x []T) (any, error) {
		out := make([]any, len(x))
		for i, item := range x {
			v, err := f(item)
			if err != nil {
				return nil, err
			}
			out[i] = v
		}
		return out, nil
	}
}

func harnessOutMapStr[T any](f func(T) (any, error)) func(map[string]T) (any, error) {
	return func(x map[string]T) (any, error) {
		out := make(map[string]any, len(x))
		for k, item := range x {
			v, err := f(item)
			if err != nil {
				return nil, err
			}
			out[k] = v
		}
		return out, nil
	}
}

func harnessOutMapInt[T any](f func(T) (any, error)) func(map[int]T) (any, error) {
	return func(x map[int]T) (any, error) {
		out := make(map[string]any, len(x))
		for k, item := range x {
			v, err := f(item)
			if err != nil {
				return nil, err
			}
			out[strconv.Itoa(k)] = v
		}
		return out, nil
	}
}

func harnessOutOpt[T any](f func(T) (any, error)) func(*T) (any, error) {
	return func(x *T) (any, error) {
		if x == nil {
			return nil, nil
		}
		return f(*x)
	}
}

// harnessTrimNulls drops trailing nulls from a tree's level-order array.
func harnessTrimNulls(out []any) []any {
	for len(out) > 0 && out[len(out)-1] == nil {
		out = out[:len(out)-1]
	}
	return out
}

// ---------------------------------------------------------------- running

// harnessMain runs every test on stdin; names are the parameters in order.
func harnessMain(names []string, call harnessCall) {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "harness: cannot read stdin:", err)
		os.Exit(2)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var header map[string]any
	if err := dec.Decode(&header); err != nil {
		fmt.Fprintln(os.Stderr, "harness: bad header:", err)
		os.Exit(2)
	}
	nonce, ok := header["nonce"].(string)
	if !ok {
		fmt.Fprintln(os.Stderr, `harness: the first line must be {"nonce": "..."}`)
		os.Exit(2)
	}
	var inputs []map[string]any
	for {
		var input map[string]any
		err := dec.Decode(&input)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "harness: bad test input:", err)
			os.Exit(2)
		}
		inputs = append(inputs, input)
	}
	for _, input := range inputs {
		args := make([]any, len(names))
		for i, name := range names {
			v, ok := input[name]
			if !ok {
				harnessEmit(nonce, map[string]any{"status": "fatal", "message": fmt.Sprintf("test input has no %q", name)})
				os.Exit(2)
			}
			args[i] = v
		}
		record := harnessRunOne(call, args)
		harnessEmit(nonce, record)
		if record["status"] == "fatal" {
			os.Exit(2)
		}
	}
	os.Exit(0)
}

func harnessRunOne(call harnessCall, args []any) (record map[string]any) {
	start := time.Now()
	defer func() {
		if r := recover(); r != nil {
			record = map[string]any{
				"status":     "error",
				"error_type": "panic",
				"message":    fmt.Sprint(r),
				"time_ms":    harnessRound(float64(time.Since(start).Nanoseconds()) / 1e6),
			}
			if line := harnessPanicLine(); line > 0 {
				record["line"] = line
			}
		}
	}()
	actual, ms, err := call(args)
	var inErr harnessInputError
	var outErr harnessOutputError
	switch {
	case errors.As(err, &inErr):
		return map[string]any{"status": "fatal", "message": "cannot convert a test input: " + inErr.msg}
	case errors.As(err, &outErr):
		return map[string]any{"status": "error", "error_type": "output", "message": outErr.msg, "time_ms": harnessRound(ms)}
	case err != nil:
		return map[string]any{"status": "error", "error_type": "error", "message": err.Error(), "time_ms": harnessRound(ms)}
	}
	return map[string]any{"status": "ok", "actual": actual, "time_ms": harnessRound(ms)}
}

// harnessPanicLine finds the innermost line in solution.go on the panicking stack.
func harnessPanicLine() int {
	pcs := make([]uintptr, 64)
	n := runtime.Callers(2, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	for {
		f, more := frames.Next()
		if strings.HasSuffix(f.File, "/solution.go") || f.File == "solution.go" {
			return f.Line
		}
		if !more {
			return 0
		}
	}
}

func harnessRound(ms float64) float64 {
	return math.Round(ms*1000) / 1000
}

func harnessEmit(nonce string, record map[string]any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(record); err != nil {
		buf.Reset()
		msg, _ := json.Marshal("the return value cannot be written as JSON: " + err.Error())
		buf.WriteString(`{"status":"error","error_type":"output","message":` + string(msg) + "}\n")
	}
	os.Stdout.Write(append([]byte("\x1e"+nonce+" "), buf.Bytes()...))
}
