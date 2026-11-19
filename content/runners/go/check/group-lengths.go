// Check solution (T15): group words by length. Exercises map<int, list<string>>.
package main

import (
	"fmt"
	"unicode/utf8"
)

func groupLengths(words []string) map[int][]string {
	out := map[int][]string{}
	for _, w := range words {
		n := utf8.RuneCountInString(w)
		out[n] = append(out[n], w)
	}
	fmt.Println("groups:", len(out))
	return out
}
