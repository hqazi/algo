// Check solution (T15): average price per item. Exercises float and map<string, _> inputs.
package main

func basketAverage(prices map[string]float64, counts map[string]int) float64 {
	items, total := 0, 0.0
	for k, c := range counts {
		items += c
		total += prices[k] * float64(c)
	}
	if items == 0 {
		return 0
	}
	return total / float64(items)
}
