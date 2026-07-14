# Third-party notices

Solodot adapts narrowly scoped architecture and protocol behavior from the following MIT-licensed projects. It does not install their full provider stacks.

## pi-orchestrator

- Source: `https://github.com/ozgureyilmaz/pi-orchestrator`
- Pinned reference: `a123a4ad925e2d49d4ac33c9e70a10fefa339d54`
- Adapted ideas: bounded concurrent waves, self-contained isolated worker briefs, planner/worker/synthesizer separation, and one verified synthesis.

MIT License

Copyright (c) 2026 Ozgur Yilmaz

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## pi-advisor

- Source: `https://github.com/ozgureyilmaz/pi-advisor`
- Pinned reference: `33a3e204882e8b8587b26bfbc31df092d8b2bc16`
- Adapted ideas: a balanced main executor, read-only high-value review gates, compact decision packets, and no advisor call for routine work.

MIT License

Copyright (c) 2026 Ozgur Yilmaz

The MIT terms above apply.

## Pi OpenAI Codex client

- Package: `@earendil-works/pi-ai@0.80.6`
- Source: `https://github.com/earendil-works/pi/tree/main/packages/ai`
- Adapted files: the OpenAI Codex public-client device authorization flow and the subscription Responses request contract.
- Solodot changes: only OpenAI code is retained, credentials are encrypted with AES-256-GCM, the request originator identifies `solodot`, and API-key fallback requires explicit founder approval.

The package is distributed under the MIT License. Copyright remains with its respective authors and contributors. The same MIT grant and warranty disclaimer printed above apply.
