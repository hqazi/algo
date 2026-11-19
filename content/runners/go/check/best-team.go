// Check solution (T15): highest score, first on ties. Exercises tuple<char, int> and optional.
package main

func bestTeam(scores []Tuple) *Tuple {
	var best *Tuple
	for i := range scores {
		if best == nil || scores[i].V1 > best.V1 {
			best = &scores[i]
		}
	}
	return best
}
