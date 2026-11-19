// Check solution (T15): average price per item. Exercises float and map<string, _> inputs.
use std::collections::HashMap;

pub fn basket_average(prices: HashMap<String, f64>, counts: HashMap<String, i64>) -> f64 {
    let items: i64 = counts.values().sum();
    if items == 0 {
        return 0.0;
    }
    let total: f64 = counts.iter().map(|(k, c)| prices[k] * *c as f64).sum();
    total / items as f64
}
