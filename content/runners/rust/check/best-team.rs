// Check solution (T15): highest score, first on ties. Exercises tuple<char, int> and optional.
pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {
    let mut best: Option<(char, i64)> = None;
    for s in scores {
        if best.map_or(true, |b| s.1 > b.1) {
            best = Some(s);
        }
    }
    best
}
