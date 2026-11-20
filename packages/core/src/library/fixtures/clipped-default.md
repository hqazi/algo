---
title: "Binary search, step by step"
source: "https://example.com/articles/binary-search"
author:
  - "[[Ada Example]]"
  - "[[Sam Sample]]"
published: 2026-10-02
created: 2026-11-20
description: "A hand-made sample in the shape of a note saved by the Obsidian Web Clipper's default template."
tags:
  - "clippings"
---
Binary search halves the range on every step. This text was written for the
Algo tests; it is not from a real article.

![A sorted array with the middle element marked](https://example.com/images/middle.png)

## Why it works

[![A diagram, linked to a larger copy](https://example.com/images/diagram-small.png)](https://example.com/images/diagram.png)

The loop keeps one invariant: the answer, if it exists, is inside `[lo, hi]`.
