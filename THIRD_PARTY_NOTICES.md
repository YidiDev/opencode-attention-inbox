# Third-party acknowledgments

OpenCode Attention Inbox is authored and maintained by **YidiDev**. Original
contributions and modifications are MIT licensed; this does not replace the
rights of upstream authors or dependency authors.

## Derived foundation

The project derives from [opencode-session-history](https://github.com/ypxcs/opencode-session-history)
by **Yash Patel**, MIT, version 0.1.5, original commit
`2d61f0cd5205ef673fb547a3a5e7b454796c026b`. The original copyright notice and MIT
permission/disclaimer are retained in LICENSE; NOTICE describes the derivative.

## Host and development tools

| Project | Use | License |
| --- | --- | --- |
| [OpenCode](https://github.com/anomalyco/opencode) | Host plugin/client APIs | MIT |
| [OpenTUI](https://github.com/anomalyco/opentui) | Native terminal renderer and Solid integration | MIT |
| [Solid](https://github.com/solidjs/solid) | Reactive UI and universal JSX compiler | MIT |
| [Babel](https://github.com/babel/babel) | Development-time TypeScript/JSX compilation | MIT |
| [Biome](https://github.com/biomejs/biome) | Development-time formatting/linting | MIT OR Apache-2.0 |
| [Istanbul](https://github.com/istanbuljs/istanbuljs) | Development-time source coverage | BSD-3-Clause |
| [TypeScript](https://github.com/microsoft/TypeScript) | Development-time type checking | Apache-2.0 |
| [Bun](https://github.com/oven-sh/bun) | Development/test runtime | MIT |

The archive contains this project's source and universal-precompiled modules,
not bundled copies of these runtimes/tools. npm distributes dependency packages
separately with their own license notices; the host supplies its Solid/OpenTUI
runtime. Installed transitive packages retain their respective licenses, including
Apache-2.0, ISC, BSD, BlueOak and public-domain licenses. Development data packages
[caniuse-lite](https://github.com/browserslist/caniuse-lite) (CC-BY-4.0) and
[spdx-exceptions](https://github.com/jslicense/spdx-exceptions.json) (CC-BY-3.0)
are not copied into dist. This acknowledgment is not a relicensing of dependencies.

None of these projects or authors endorses or is affiliated with this derivative.
