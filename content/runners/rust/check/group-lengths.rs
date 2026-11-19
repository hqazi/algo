// Check solution (T15): group words by length. Exercises map<int, list<string>>.
use std::collections::HashMap;

pub fn group_lengths(words: Vec<String>) -> HashMap<i64, Vec<String>> {
    let mut out: HashMap<i64, Vec<String>> = HashMap::new();
    for w in words {
        out.entry(w.chars().count() as i64).or_default().push(w);
    }
    println!("groups: {}", out.len());
    out
}
