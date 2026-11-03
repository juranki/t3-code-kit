# Third-party notices

This repository is MIT-licensed (see `LICENSE`). It also contains code and
prose derived from other MIT-licensed projects. Their notices are reproduced
below, as those licences require.

## t3code — https://github.com/pingdotgg/t3code

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

What in this repository derives from it:

| Where                                                                                                                                  | What                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/host/src/HostProcess.ts`                                                                                                     | Transcribed from `packages/shared/src/HostProcess.ts`, trimmed to what a `sbx` launcher reads. |
| `scripts/probe-sbx.ts`                                                                                                                 | The `PATHEXT` resolution note is derived from `shell.ts`.                                      |
| `docs/adr/0002-v2-workspace-layout-and-distribution.md`, `docs/design/sbx-seam.md`, `agent-patterns/effect-*.md`, `prototype/spike.md` | Prose that describes and compares against t3code's configuration.                              |
| `apps/cli`, `packages/*`                                                                                                               | Conventions (module order, naming, error rules) follow t3code's.                               |

## Effect — https://github.com/Effect-TS/effect

```
MIT License

Copyright (c) 2023 Effectful Technologies Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`repos/effect/` is a git subtree pinned to the `effect@4.0.5` tag and keeps
its own `LICENSE` file. See `agent-patterns/README.md` for why it is vendored.
