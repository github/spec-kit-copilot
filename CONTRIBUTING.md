# Contributing to the Spec Kit Copilot Plugin

Hi there! We're thrilled that you'd like to contribute to the Spec Kit Copilot Plugin. Contributions to this project are [released](https://help.github.com/articles/github-terms-of-service/#6-contributions-under-repository-license) to the public under the [project's open source license](LICENSE).

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## About this repository

This repository is a [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli) **skills plugin**. It does not contain application code — it is a set of Markdown skill files that teach the Copilot agent how and when to drive the Spec Kit [`specify`](https://github.com/github/spec-kit) CLI. Its layout is:

- `plugin.json` — the plugin manifest (required).
- `skills/<name>/SKILL.md` — one skill per `specify` command group (YAML frontmatter + Markdown body).
- `.github/plugin/marketplace.json` — the marketplace manifest used for distribution.
- `AGENTS.md` — maintainer guidance and the design decisions behind the plugin. **Read this before adding, removing, or regenerating skills.**

## Prerequisites

1. Install the [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli).
2. Install the Spec Kit `specify` CLI (used to enumerate the command surface the skills wrap):

   ```bash
   uv tool install specify-cli   # or: pipx install specify-cli
   specify --version
   ```

## Making a change

1. Fork and clone the repository.
2. Create a new branch: `git checkout -b <type>/<short-slug>`.
3. Make your change. When editing skills, keep the design decisions in [`AGENTS.md`](AGENTS.md) intact — in particular, the integration is always Copilot in skills mode, and there is intentionally no integration-management skill.
4. Install the plugin locally and verify it loads with the expected skill count:

   ```bash
   copilot plugin install ./
   copilot plugin list
   ```

5. Push to your fork and [submit a pull request](https://github.com/github/spec-kit-copilot/pulls).
6. Wait for your pull request to be reviewed and merged.

Here are a few things you can do that will increase the likelihood of your pull request being accepted:

- Keep each `SKILL.md` focused on a single `specify` command group, with a discovery-oriented `description` (USE FOR / DO NOT USE FOR) and an accurate list of subcommands and options.
- Keep the change as focused as possible. If there are multiple unrelated changes, submit them as separate pull requests.
- Write a [good commit message](https://cbea.ms/git-commit/).
- Update the README and `AGENTS.md` if your change affects behavior or the skill set.

### Versioning

This plugin tracks the `specify` CLI version in lockstep. When revving, bump `plugin.json` and both versions in `.github/plugin/marketplace.json` together to the targeted `specify` release, and update the README "Versioning" note. See [`AGENTS.md`](AGENTS.md) for the full checklist.

## Resources

- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Using Pull Requests](https://help.github.com/articles/about-pull-requests/)
- [GitHub Help](https://help.github.com)
