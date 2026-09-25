# Implementation Plan: Canvas Generation as a Spec Kit Extension

## 1. Outcome

Extract the canvas-generation implementation introduced by
`github/spec-kit-copilot#32` from the Spec Kit Wizard into a separately installable
Spec Kit extension.

The resulting system must:

1. Generate the same standalone Copilot canvas extension that PR #32 generates.
2. Work without opening or installing the Wizard.
3. Preserve PR #32's compact per-canvas Name, Workflow header, Description, custom
   slug, and installation-approval settings as exact structured request values.
   Move result, clarification, and deeper generated-application behavior into
   extension-owned default experience templates. Separately installed presets may
   replace those templates directly or modify the generation command with
   natural-language guidance that is normalized into supported configuration.
4. Expand that behavior contract beyond the current settings to cover the generated
   app's visual design, information architecture, interactions, artifact experience,
   status model, guidance, and onboarding.
5. Preserve the deterministic compiler, protected runtime files, path validation,
   installation approval, and standalone setup behavior from PR #32.
6. Safely regenerate an existing canvas without silently destroying customer edits.
7. Use Spec Kit's machine-readable composition APIs as the precedence authority
   instead of Wizard-owned resolvers and human-output parsers. When an API omits
   classification metadata such as package tags, read that bounded field directly
   from the installed package manifest without reconstructing composition.
8. Keep the first release intentionally scoped while using versioned contracts,
   resolver boundaries, and renderer/runtime interfaces that allow additional
   customization categories to be added later without replacing the architecture.

## 2. Selected architecture

```text
User / Wizard
     |
     +-- workflow, phase order, compact instance settings, target
     |
Effective Spec Kit composition
     +-- preset/extension-resolved JSON experience configuration
     +-- selected renderer manifest and static package
     +-- effective speckit.canvas.generate command
     |
     v
Copilot create-canvas authoring workflow
     +-- load the create-canvas skill before other generation tools
     +-- read the bundled SDK guide
     +-- for a new target, create the required project-scoped scaffold and move it
         into request staging before materialization
     |
     v
Extension-local deterministic materializer
     +-- captures exact inputs and provenance
     +-- compiles immutable pipeline blueprint
     +-- builds one complete candidate in request staging for Generate or Regenerate
     +-- removes every file not declared by the compiled generated-file manifest
     +-- writes validated deterministic configuration
     +-- validates complete output and generation receipt
     +-- replaces the disposable .github/extensions/<canvas-id>/ output
```

### Terminology

- **Canvas Generator Extension:** the Spec Kit extension package. It owns the
  generation command, scripts, compiler, templates, schemas, and lifecycle logic.
- **Base generation command:** the
  `commands/speckit.canvas.generate.md` file shipped by the Canvas Generator
  Extension.
- **Preset:** a separate, optional package installed independently from the
  extension. It does not invoke generation and does not own the base command.
- **Effective generation command:** the command Spec Kit resolves for execution.
  With no applicable preset, this is exactly the extension's base command. When
  presets target that command, Spec Kit applies their configured strategies and
  registers the resulting effective command for Copilot.

The Wizard and the effective generation command have different responsibilities.

### Core design principles

> Generate a standalone application by combining a versioned static renderer and
> protected runtime with an immutable authoritative workflow blueprint and
> validated Spec Kit-resolved configuration. Keep the generated application's
> default experience extension-owned and replaceable at an explicit boundary, and
> preserve deterministic generation, portability, security, and future
> extensibility.

These principles govern the architecture and every implementation PR:

1. **The Wizard and generator own independent presentation resources.** The Wizard
   owns, versions, tests, and ships its live workflow UI. The Canvas Generator
   Extension separately owns, versions, tests, and ships the generated
   application's default renderer. They may begin with similar presentation and
   share a documented runtime API contract, but neither loads renderer files from
   the other's installed package or requires byte-for-byte visual parity.
2. **The presentation layer is replaceable as a whole.** A Canvas Design preset or
   extension may replace the default renderer package when supported configuration
   cannot express the desired UX. Replacement changes the frontend while retaining
   the protected workflow backend and security model. Exactly one renderer is
   active; renderer packages are replaced, not textually merged.
3. **The base generator begins with the supported Copilot canvas-authoring path.**
   Build the authoritative request and complete validated generation brief in the
   same Copilot agent turn that invokes the `create-canvas` skill; invoking the
   skill supplements that existing context rather than starting a context-free
   generation path. Invoke the skill and current scaffold tooling before
   constructing the application. Use that workflow to establish as much of the
   canvas structure, SDK wiring, lifecycle, server, actions, and renderer foundation
   as it supports so generated applications follow current canvas conventions.
   Subsequent validated scripts may generate, copy, add, or refine files and
   resources when the scaffold does not provide the required product behavior; there
   is no blanket prohibition on those operations. The base generator must never
   bypass `create-canvas` and independently construct the application from an empty
   directory. A customer preset that completely replaces the generation command
   assumes ownership of its own authoring workflow and may use a different
   implementation; generator-owned conformance and safety guarantees apply only if
   that replacement independently satisfies the required contracts.
4. **Dynamic behavior is validated data, not generated code.** Wizard selections
   and Spec Kit-resolved JSON provide the dynamic configuration. The generator
   combines static packages with that data and performs only explicit, bounded
   substitutions.
5. **Normalized inputs and generated contracts are reproducible.** The same
   generator version, authoritative request, workflow blueprint, resolved category
   documents, captured command-derived experience override, and renderer contract
   must produce the same application semantics and validated public contracts.
   Deterministic scripts and generated data should remain byte-stable where
   practical, but source authored through the supported `create-canvas` workflow is
   not required to be byte-identical. Natural-language interpretation happens
   before the validated generation brief is captured. Customers requiring
   byte-stable reusable policy should prefer explicit JSON template replacements.
6. **The authoritative request owns workflow intent; Canvas Design providers own
   reusable experience policy.** The Wizard or Copilot CLI request producer
   supplies selected phases, order, identity, and target. Presets and eligible
   design-time extensions supply reusable terminology, theme, layout, interactions,
   result tags, onboarding, or a replacement renderer. Neither silently
   reinterprets the other's authority.
7. **Workflow composition compiles into an immutable blueprint.** Effective
   commands, phase order, artifact contracts, providers, dependencies, and setup
   requirements are captured once. The generated canvas executes that blueprint;
   it cannot reorder phases, add commands, or regenerate itself.
8. **Generated canvases are standalone and portable.** The generated extension
   vendors everything required at runtime and does not import the live Wizard or
   depend on the generation session. It retains setup and onboarding behavior when
   transferred to another compatible repository.
9. **Protected runtime and supported customization have an explicit boundary.**
   Backend execution, path authorization, setup, phase dispatch, state calculation,
   and security remain protected. Named JSON configuration and the renderer package
   are the primary customization surfaces.
10. **Validate final output, not only generation inputs.** Generation succeeds only
    after verifying protected hashes, exact blueprint equality, configuration
    schemas, renderer capabilities, required actions, forbidden capabilities, and
    path confinement.
11. **Fail explicitly rather than silently degrade.** Unsupported topology, invalid
    configuration, missing providers, unsafe paths, renderer incompatibility, and
    unknown schema fields produce actionable errors rather than changing behavior
    through fallback.
12. **Snapshot generation inputs.** Capture the exact blueprint, static runtime and
    renderer versions, resolved configuration, and provenance used for generation.
    Changes to the live Wizard or installed presets during generation must not
    change an in-flight result.
13. **Preserve effective Spec Kit composition and provenance.** Capture the commands,
    presets, extensions, versions, priorities, and sources that produced the
    workflow. The generator does not independently approximate composition
    precedence.
14. **Resolve composition once per generation run through Spec Kit.** The Wizard
    server uses the
    existing machine-readable Specify artifact, preset, and extension list commands
    through the same
    direct `specifyRun(...)` pattern already used for passive preset and extension
    catalog reads. It builds one normalized cached composition model for the Wizard
    Composition page, then refreshes that same model when Generate or Regenerate
    captures the new per-run request. Standalone Copilot CLI invocation uses the
    same Specify JSON surface through extension-owned request preparation. Neither
    path maintains a separate precedence assembler or asks the model to reconstruct
    composition.
15. **Setup is portable, explicit, and permission-preserving.** The generated canvas
    may detect and install required Spec Kit components, but external installation
    may require explicit approval and must not bypass Copilot host permissions.
16. **Runtime state is evidence-derived.** Completion, staleness, progress, result
    tags, and clarification are reconstructed from current artifacts and settled
    phase-run evidence rather than cumulative mutable counters. Reruns replace
    current state instead of creating duplicate history.
17. **Execution and artifact existence are distinct.** Existing files do not prove
    the generated canvas ran a phase, and a successful transient phase may create no
    artifact. Successful dispatch and artifact-backed completion are tracked
    separately.
18. **Project-level artifacts are modeled separately.** Items such as Constitution
    are project prerequisites rather than repeated workflow-item phases.
19. **Unsupported workflow shapes remain explicit scope boundaries.** The initial
    generator supports a simple linear workflow. Contracts may grow later, but
    unsupported topology is rejected rather than rendered inaccurately.
20. **Reporting is subordinate to successful generation and execution.** Wizard
    callbacks, analytics, and optional reporting cannot turn a valid generated
    canvas or successful phase dispatch into a failure. Reporting failures remain
    visible and separate.
21. **Generated output is disposable.** The generated extension directory is a
    build artifact, not a customization surface. Regeneration validates a complete
    fresh candidate, explicitly confirms deletion of any exact existing target,
    deletes it as a whole, and publishes the replacement without backup or rollback.
    Durable customer modifications belong in presets, Canvas Design extensions, or
    a separately owned repository location.
22. **The architecture is extensible while the initial public surface stays
    intentionally small.** Use versioned schemas, renderer contracts, source types,
    and provider boundaries that permit future customization without replacement.
    Initially expose only scenarios grounded in Assess, Bugfix, SDD, and PR #32.
    Avoid arbitrary formulas, executable callbacks, and implementation-level
    switches when finite semantic configuration is sufficient.
23. **Design-time and runtime components have different lifecycles.** Canvas Design
    presets and extensions are installed in the Wizard project and participate while
    generating or regenerating an application. Their resolved configuration,
    renderer, assets, and validation results are materialized into generated files;
    they are not automatically dependencies of the generated application. Presets
    and extensions that provide commands used by pipeline phases are runtime
    dependencies and must remain available where the generated canvas runs.
24. **Canvas Design component management follows the existing Wizard Catalog
    model.** The Generate dialog reuses the Catalog's immediate, one-component-at-a-
    time Add/Remove behavior and community confirmation. Add installs a component
    immediately; Remove uninstalls it immediately so it no longer participates in
    design-time composition. Generate never mixes package additions and removals in
    a batch.
25. **Use one physical project with tag-based Canvas Design classification.**
    Maintain one `.specify` project and registry. Use the existing free-form
    `canvas-design` package/catalog tag to identify design-time presets, extensions,
    and bundles in Wizard surfaces. When Specify's installed-list JSON does not
    expose tags, the Wizard reads them directly from the installed `preset.yml` and
    `extension.yml` manifests. Untagged packages remain ordinary runtime packages.
    Tags classify Wizard and generated-app catalog presentation; they do not change
    Specify precedence, resolver behavior, or artifact identity. Do not create a
    nested or second `.specify` project.

Exact byte limits, filenames, CSS load order, persistence directory names, parsing
expressions, timeout values, and UI copy are implementation details rather than
public architecture. They remain bounded and tested without becoming preset
contracts.

### Wizard responsibility

Specify's artifact snapshot determines:

- installed workflow presets and extensions;
- their versions, priorities, enabled state, effective artifact stacks, and
  provenance.

For Wizard invocation, the Wizard determines:

- included phases and their order;
- canvas ID, display name, workflow collection heading, and description;
- whether the generated app asks for a workflow slug;
- whether the generated app prompts before installing its exact captured runtime
  dependency set;
- target location and overwrite confirmation;
- installed and enabled Canvas Design presets and extensions;
- community approval for each Canvas Design component added through the Generate
  dialog.

Keep the common instance settings narrowly scoped. Reuse PR #32's existing
single-column **Generate canvas** modal, field order, wording, descriptions,
control types, accessibility associations, preflight messages, and overwrite
confirmation:

1. read-only **Target** — `Folder where the canvas app is created. Set by
   Extension ID.`;
2. **Extension ID** — `Technical ID and folder name, not a display label. Use
   lowercase letters, numbers, and hyphens.`;
3. **Name** — `Text displayed as the canvas title.`;
4. **Workflow header** — `Text displayed as the workflow collection heading,
   such as Assessments or Bugs.`;
5. **Description** — `Text displayed beneath the workflow collection heading,
   before the folder link.`;
6. **Allow custom slug** — `Lets users specify the slug used as the directory
   name for generated artifacts. Otherwise, Spec Kit chooses a default or Copilot
   may ask the user in the chat session.`;
7. **Require installation approval** — `Ask users to approve all included presets
   and extensions before installation. Otherwise, the app automatically installs
   missing components without asking for installation approval.`.

Do not expose per-phase settings, general guidance, theme, layout, detailed
onboarding copy, result labels, or clarification configuration in the common
Generate form. In particular, do not carry PR #32's Phase result tags editor
forward as an instance setting. The generator owns helpful default copy; reusable
or deeper customization belongs in Canvas Design presets and extensions.

### Authoritative request producers

The Wizard is not required to use the generator. Both supported entry paths produce
the same versioned generation request:

```text
Wizard invocation
  -> user confirms the current pipeline, identity, workflow heading, description,
     slug behavior, installation-approval behavior, target, and overwrite choice
  -> extension-owned request preparation refreshes the current artifact, preset,
     and extension JSON through Specify
  -> validate and normalize that fresh composition
  -> update the Wizard's cached Composition state from the same captured snapshot
  -> write the authoritative request from that snapshot plus confirmed Wizard state
  -> invoke speckit.canvas.generate with the request path

Copilot CLI invocation
  -> project is initialized for Copilot skills mode
  -> pipeline-canvas-generator and any desired Canvas Design presets/extensions
     are already installed through Specify
  -> reload skills after package installation
  -> user invokes the installed speckit-canvas-generate skill
  -> collect missing workflow, identity, workflow heading, description, slug
     behavior, installation-approval behavior, target, and overwrite values
     through command arguments and ask_user
  -> extension-owned Python request preparation calls the same Specify artifact,
     preset, and extension JSON commands
  -> validate, normalize, fingerprint, and write the same request schema under the
     project-local generation control root
  -> invoke the same generator entry point
```

Every Generate and Regenerate operation captures a fresh composition. Presets,
extensions, priorities, enabled state, Canvas Design providers, and current phase
selection/order changed since the previous generation are therefore reflected in
the new request. Once that request is written, its artifact snapshot is the source
of truth for that one run's providers, priorities, artifact stacks, active layers,
source paths, and provenance. Do not resolve composition a second time during
materialization and silently substitute a different state.

The Wizard remains the source of truth for user-authored pipeline order and
confirmed generation choices. The compact instance settings are normalized into
the request rather than left as natural-language instructions. Extension-owned
request-preparation code owns the machine-readable Specify calls, schema
validation, normalization, and fingerprint calculation. The model supplies only
human choices and optional supported generation guidance; it never copies or
reconstructs the full artifact snapshot.

The Copilot CLI path does not depend on the Wizard or its saved state. It derives
the available runtime phases and current Canvas Design composition from the
project's installed Specify packages, asks the user to confirm the desired phases
and order, and collects the canvas identity, workflow heading, description, slug
behavior, installation-approval behavior, target, and overwrite choice. It does
not install or remove optional Canvas Design packages during generation; users
manage those beforehand with the existing Specify preset, extension, and bundle
commands.

The Copilot CLI path may invoke the extension-owned request-preparation and
command-override steps; it must not create or edit generated application files
outside the shared materializer flow. Request preparation may be a function or
mode inside `canvas_generate.py` or a small sibling helper; that file split is an
implementation detail. Once the request exists, both paths use identical
compilation, validation, staging, generation receipt, publication, and `result.json`
reporting. Tests compare Wizard- and Copilot-CLI-produced requests and generated
output for equivalent captured inputs.

This standalone path still requires the Copilot CLI canvas-authoring capabilities,
including the installed `create-canvas` skill and extension scaffold/reload tools.
Running the Python materializer directly or using the bare `specify` executable
without Copilot is not a supported generation entry point.

### Generation control directory

Use one ignored, project-local, Spec Kit-owned control root:

```text
.specify/.cache/canvas-generation/<request-id>/
  request.json
  command-override-draft.json
  command-override.json
  result.json
```

`request.json` is the immutable per-run Wizard/Copilot CLI authority. During
execution of the effective generation command, Copilot writes only
`command-override-draft.json`, containing the sparse `categories` object it
derived from the effective command. The object is empty when no supported values
are derived. The extension-owned `canvas_generate.py prepare-override` operation
validates that draft, calculates the authoritative request digest, and atomically
writes the final `command-override.json`. The draft is not a materializer input and
may be deleted after successful finalization. `result.json` is the single
authoritative machine-readable materializer outcome used by the effective command
and Wizard reporting path.

The generator writes `result.json` atomically as its final operation for every
controlled success or failure. A missing result file means the process was
interrupted and must never be interpreted as success. Stdout may contain concise
diagnostic progress, but it is not parsed as a result contract and must not contain
a second independently authoritative copy of the result.

The entire `.specify/.cache/` subtree must be excluded from version control. Control
files must not contain credentials, auth tokens, loopback callback secrets, or
other reusable secrets. Every path is canonicalized beneath the generated
request-ID directory; symlinks and escapes are rejected.

Lifecycle:

```text
Successful publication and result consumption
  -> record request/override hashes and bounded provenance in .speckit-canvas.json
  -> delete the request-specific control directory

Controlled failure
  -> write and present the failure result
  -> clean the failed request directory after result consumption
  -> offer the ordinary Regenerate action

Later Wizard/generator startup
  -> remove interrupted request directories through bounded request-ID-specific cleanup
```

There is no retained publication recovery state. Cleanup never recursively targets
`.specify`, `.specify/.cache`, the repository, or an unresolved path.

The project-local control directory also contains the shared candidate staging
area:

```text
.specify/.cache/canvas-generation/<request-id>/
  request.json
  command-override-draft.json
  command-override.json
  result.json
  staging/       # fresh regeneration candidate
```

### Copilot `create-canvas` dependency and orchestration

Preserve PR #32's canvas-authoring pattern rather than replacing it with a
standalone file generator. `speckit.canvas.generate` must invoke the Copilot
`create-canvas` skill before any other generation tool call. The skill is a
design-time authoring dependency supplied by the Copilot host; it is not a Spec Kit
preset or extension and is not a generated-canvas runtime dependency.

The effective generation command is one Copilot agent turn. Before invoking the
skill, that turn has the authoritative request and the complete validated
generation brief, including canvas identity and target, immutable workflow and
artifact contracts, the exact instance name, workflow header, description,
workflow-slug choice, and installation mode, runtime dependencies and setup
behavior, resolved experience configuration, renderer selection and requirements,
required actions, security and path constraints, and validation requirements.
These values guide the scaffold but are not informal model authority: the same
normalized values remain in `request.json` for deterministic refinement and final
validation. Invoking `create-canvas` loads the supported authoring procedure into
that same turn; it does not start a separate agent or discard the accumulated
construction context.

The effective generation command performs this sequence:

```text
load authoritative request and complete validated generation brief
  -> invoke skill("create-canvas") in the same agent turn
  -> call extensions_manage guide
  -> obtain a fresh supported scaffold for Generate or Regenerate
  -> immediately move the scaffold into confined request staging without reload
  -> validate the scaffold contract
  -> refine the scaffold using the generation brief, resolved configuration,
     declared packaged resources, and bounded scripts
  -> validate the complete application and configuration contracts
  -> for an existing target, show the exact-path destructive confirmation
  -> acquire the target lock, delete any confirmed existing target, and install
     the validated candidate into the final target
  -> reload Copilot extensions
  -> inspect and require a running provider
  -> report completion
  -> open the generated canvas once for handoff
```

The generated `extension.mjs` uses the supported Copilot SDK canvas model:

```text
@github/copilot-sdk/extension
  -> joinSession(...)
  -> createCanvas(...)
  -> loopback-only HTTP renderer URL
  -> declared canvas actions
  -> onClose cleanup
```

The `create-canvas` skill and `extensions_manage guide` establish as much of the
current host/SDK structure, wiring, lifecycle, server, actions, and renderer
foundation as the supported workflow provides. The complete generation brief tells
that same agent turn what application is being built. Extension-owned scripts then
perform only the validated product-specific generation and refinement that the
scaffold does not provide, including workflow/configuration compilation, packaged
resource application, exact application of the normalized instance settings, and
final contract validation. `create-canvas` output is the scaffold; the refined and
validated candidate is the generated application.

If the host cannot resolve the `create-canvas` skill or canvas scaffold tooling,
generation fails before modifying the final target and reports that the current
Copilot environment lacks the required canvas-authoring capability. Where
capability discovery is available, the Wizard Environment page should expose this
as readiness; otherwise the generation command reports the actionable failure.

Generate and Regenerate use one candidate-building path under the request's
`.specify/.cache/canvas-generation/<request-id>/staging/` directory. Each operation
obtains a fresh project-scoped scaffold through `create-canvas`. For regeneration,
the agent uses a unique temporary project-extension name and moves the scaffold into
staging without reloading it. The prior generated target is never the foundation of
the new candidate.

The common refinement pipeline treats the supported scaffold as the application
foundation. It preserves and adapts scaffold-owned structure where it satisfies the
brief, applies validated product-specific files and resources where needed, and
removes undeclared examples and temporary files. It must not discard the scaffold
and independently construct the application from an empty directory.
The previous target is not a generation input and is not backed up. After explicit
confirmation, delete the exact target as a whole regardless of receipt validity,
then publish the validated candidate. Do not merge files, preserve unknown entries,
or treat manual edits inside the generated directory as durable customization.
Reload extensions only after successful publication.

### Generation-command responsibility

The Canvas Generator Extension provides `speckit.canvas.generate`. Its six default
JSON templates define the complete default generated-app experience. Both Canvas
Design presets and extensions may customize the generator:

- presets are the optimized and expected path for composing
  `speckit.canvas.generate` with `prepend`, `append`, `wrap`, or `replace`, and for
  replacing named JSON templates or the renderer;
- extensions may replace named non-command templates or the renderer and may add
  distinct design-time commands that the effective generation command or Generate
  experience explicitly invokes.

Because extension command-name collisions are rejected, a customer extension does
not redeclare `speckit.canvas.generate`; command composition of that existing
command is performed through presets. Extensions provide additional named commands
and reusable design-time behavior around the canonical generation command.

During its execution, the effective command must write one sparse
**command-derived experience override draft** containing only a `categories`
object. It then invokes the extension-owned
`canvas_generate.py prepare-override` operation, which validates the draft and
writes the final request-bound `command-override.json`. The finalized file is
always present before materialization; when no supported values are derived, it
contains an empty `categories` object. The generator resolves the six complete
experience templates, applies the command-derived override only to categories that
remain extension-provided, and emits the final normalized
**canvas experience profile**. If a customer Canvas Design provider explicitly
replaces a category template, that complete category wins over command-derived
guidance.

Both the command-derived override and final profile must preserve the
authoritative workflow and canvas identity. The supported profile covers the
following generated-app behavior.

Natural-language generation guidance is convenient but is not itself the
deterministic artifact. Determinism begins after the effective command has emitted
and the generator has validated the normalized override. Regeneration records the
new exact override in the technical generation receipt; it does not claim that a
fresh agent interpretation of the same prose must produce identical JSON.

#### Terminology and content

- workflow collection name and singular item terminology;
- application description and general workflow text;
- headings, labels, button text, empty states, and non-setup workflow recovery
  copy;
- domain-specific language such as assessment, case, initiative, or feature.

#### Visual design

- color palette and theme;
- typography;
- spacing and density;
- borders, elevation, and card styling;
- icons, logos, and branding;
- semantic colors that remain compatible with host-provided light/dark theme
  tokens.

#### Information architecture

- sidebar, tabs, or single-page structure;
- horizontal or vertical pipeline;
- placement of project-level items such as Constitution;
- workflow grouping and visual placement.

#### Workflow interaction

- step-by-step execution or free navigation;
- visibility of locked or future phases;
- start, resume, rerun, and confirmation behavior;
- active workflow selection;
- input retention;
- completed-phase collapse behavior;
- empty, loading, blocked, partial, and completed states.

#### Phase and artifact experience

- phase-card structure and action placement;
- phase-description visibility;
- inline versus dedicated artifact views;
- Markdown presentation and metadata;
- clarification and amendment placement;
- unavailable-artifact and folder-navigation behavior;
- standard responsive behavior supplied by the renderer.

#### Status and result behavior

- result-label vocabulary;
- clarification status behavior;
- phase-level versus workflow-level summaries;
- semantic tones and attention-required emphasis.

#### Setup and onboarding behavior

- whether users may provide workflow slugs;
- launch-time dependency installation mode;
- installation-review copy;
- readiness, first-run, help, recovery, and retry copy.

#### Launch-time prerequisites and runtime-component setup

The immutable blueprint captures the complete set of presets, extensions, and
skills required to execute the generated workflow. It does not include
generation-only presets whose theme, layout, result tags, onboarding, or renderer
configuration has already been materialized into the generated application.

Before applying any installation policy, the generated canvas verifies an
externally provisioned Spec Kit foundation:

- the `spec-kit-copilot` Copilot plugin is installed at a compatible version;
- the installed `specify` CLI satisfies the captured minimum version required by
  the existing artifact, preset, extension, and initialization contracts used by
  the application;
- the destination folder has already been initialized for Copilot skills mode;
- the host supports the required skill/plugin reload behavior.

Initialization readiness is a read-only probe, not an unconditional `init` call.
The protected setup engine:

1. verifies the compatible CLI version before interpreting project metadata;
2. reads `.specify/init-options.json` and requires the recorded integration to be
   `copilot` with the `--skills` integration option;
3. verifies the expected `.specify/` infrastructure and at least the generated
   core Copilot skill layout under
   `.github/skills/speckit-<command>/SKILL.md`;
4. may run read-only `specify check` for tool diagnostics, but does not treat that
   command alone as proof of project initialization.

Missing, malformed, non-Copilot, or non-skills-mode initialization keeps the
generated app blocked and presents an explicit **Initialize Spec Kit** action. The
action must show a warning and require destination-user confirmation before
running:

```text
specify init --here --force --integration copilot --integration-options="--skills" --script py --ignore-agent-tools
```

The warning states that `--force` initializes the current non-empty repository,
merges Spec Kit infrastructure, and may replace conflicting Spec Kit-managed files
under `.specify/` and `.github/skills/`. It also states that initialization does
not rewrite application source or generate specifications for existing code.

After confirmation, run the command from the verified repository root, reload
skills through the supported host capability, and rerun the complete readiness
probe. A failed or cancelled initialization leaves setup blocked and reports the
CLI result without pretending readiness.

The generated canvas never installs the Copilot plugin or Specify CLI. Those
prerequisites remain owned by the user, administrator, image, bootstrap script,
developer-environment policy, or another setup process. Project initialization is
the sole foundation remediation the generated app may perform, and only after the
explicit confirmation above. The `external`, `prompt`, and `automatic`
runtime-package modes do not bypass or replace that confirmation.

This prerequisite gate also covers the case where an external process has already
initialized the folder and installed every required runtime component: the canvas
verifies the resulting state and starts without modifying it.

After that gate passes, `canvas-onboarding` controls installation of only the
captured runtime presets and extensions:

```text
external | prompt | automatic
```

- `external`: the canvas never installs components. It verifies the complete
  required runtime set and remains blocked with a missing-dependency report until
  the customer's own setup workflow installs it.
- `prompt`: the canvas displays the complete missing set and requests one
  all-or-nothing approval. **Install all** installs the set, reloads skills, and
  rechecks readiness. **Cancel** installs nothing.
- `automatic`: the canvas does not display approval UI. It installs the complete
  missing runtime-component set, reloads skills, and rechecks readiness. This is an
  administrator-authored policy captured when the canvas is generated, not a
  destination-user trust decision.

All modes use the same protected setup engine:

- compare the captured required set with installed versions, enabled state,
  priority, and required skills;
- operate on the complete missing or incompatible set, never a user-selected
  subset;
- fail closed until the effective runtime matches the blueprint;
- preserve catalog source and provider provenance;
- never embed catalog credentials or authentication data.

The administrator may select `automatic` for the exact captured dependency set,
including community components, after reviewing their identities, versions,
sources, and executable-code facts during generation. That authorization is bound
to the generated blueprint's dependency-set fingerprint. At launch, the protected
setup engine verifies exact source/provenance equality and requests only permissions
available through the Copilot host; it never treats the generated policy as
permission to bypass host or organization controls. Source drift, unavailable
credentials, or a denied host permission blocks setup rather than resolving or
installing a substitute.

In `prompt` mode, the protected renderer always displays the component type, ID,
version, catalog/source, trust classification, executable-code indication, and why
the component is required. A preset may customize the surrounding plain-text copy:

```json
{
  "installationMode": "prompt",
  "approvalCopy": {
    "title": "Prepare this workspace?",
    "message": "Review the required Spec Kit components before continuing.",
    "communitySourceWarning": "Some components are community maintained. Continue only if you trust the listed sources.",
    "confirmLabel": "Install all and continue",
    "cancelLabel": "Not now",
    "policyText": ""
  }
}
```

Copy values are bounded plain text. They may not hide or rename component facts,
remove the complete dependency list, imply partial installation, or weaken the
all-or-nothing approval. `communitySourceWarning` is required whenever the set
contains a community or otherwise untrusted source. Organization-trusted private
catalogs do not receive that warning unless organization policy supplies one.

With `prepend`, `append`, or `wrap`, the effective command may add preconditions,
post-generation validation, and reporting around the extension's base authoring
workflow. It must not directly create generated source; it passes the normalized
experience override into the `create-canvas` plus materializer flow.

A command preset using standard Spec Kit `replace` semantics is different: it
replaces the entire base command and may omit `create-canvas`, scaffold tooling, the
materializer, callbacks, validation, and handoff. The extension cannot prevent or
silently repair that behavior. Such a preset intentionally owns generation
completely and operates outside the Canvas Generator Extension's output,
compatibility, security, provenance, regeneration, and support guarantees.

### Fixed invariants

The following invariants apply whenever the extension's supported base workflow is
preserved through no command preset, `prepend`, `append`, or `wrap`:

- phases or order selected in the Wizard;
- phase command and skill mappings;
- artifact path contracts captured in the blueprint;
- required presets, extensions, and skills;
- workspace and generated-file path boundaries;
- host, origin, token, and file-access protections;
- generator ownership, disposable-target confirmation, or replacement locking;
- mandatory setup authorization and platform permission checks;
- the captured runtime dependency set, source provenance, trust classification, and
  all-or-nothing installation semantics.

A full command `replace` can bypass these invariants because it bypasses the
implementation that enforces them. The Wizard must not present output from such a
replacement as validated generator-owned output unless it independently satisfies
the complete request, callback, generation receipt, and final validation contracts.

## 3. Customization hierarchy

Use the least powerful mechanism that fully expresses the customization. The levels
are mechanisms, not mutually exclusive categories: the same outcome may be
specified directly through Level 2 configuration or derived procedurally through
Level 1 when it depends on the effective composed workflow. Each level follows an
existing Spec Kit composition pattern and has a clear ownership boundary.

The hierarchy is intentionally optimized for presets because overriding an existing
command or replacing a small set of named templates is the common customization
case. It is not preset-only. Canvas Design extensions participate in the same
captured design composition when they provide non-command templates, renderer
packages, or additional explicitly invoked design commands. Bundles may package
compatible presets and extensions together.

The generation request also carries a deliberately small instance overlay copied
from PR #32's common Generate fields. It may set only:

- canvas display name;
- `canvas-content.workflowListName`;
- `canvas-content.description`;
- `canvas-onboarding.workflowSlug.userProvided`;
- `canvas-onboarding.installationMode`, mapped from the installation-approval
  checkbox.

This overlay is not a preset and does not become a category owner. When multiple
mechanisms provide a supported value, use this precedence:

1. the allowlisted instance-request overlay for the five paths above;
2. a customer-provided Level 2 category replacement;
3. Level 1 command-derived supported overrides when the category still comes from
   the Canvas Generator Extension;
4. the extension-provided complete category default.

Because Level 2 uses complete-document `replace`, a customer-provided category is
not field-merged with natural-language command output. This keeps precedence
deterministic and avoids guessing which individual JSON fields the customer meant
to own. The higher instance overlay is different: it contains only explicit,
schema-validated values surfaced in the compact Generate form. It cannot alter
phase-specific behavior, packaged assets, result contracts, commands, artifact
paths, renderer identity, dependency identity, provenance, permission checks, or
security disclosures.

#### Category ownership and sparse-merge contract

Each category has exactly one complete-document owner: either the resolved customer
template provider or the Canvas Generator Extension default. A command-derived
override never becomes an owner; it is a bounded patch applied only when the
generator default still owns that category. The instance overlay is applied after
category resolution and command-derived merging, then the complete affected
categories and final profile are validated again.

| Category | Command-derived override may set | Command-derived override may not set |
| --- | --- | --- |
| `canvas-content` | Bounded workflow terminology, descriptions, general labels, empty-state text, and non-setup workflow recovery copy | `schemaVersion`, phase-input guidance, setup/readiness/install copy, arbitrary HTML, executable content, workflow IDs, commands, artifact paths |
| `canvas-theme` | Schema-declared semantic colors, typography enums, density, shape/elevation, and default/hidden branding values | `schemaVersion`, raw CSS/JavaScript, undeclared theme tokens, or a custom asset path that was not supplied by a resolved package |
| `canvas-layout` | Navigation style, pipeline orientation, phase-description visibility, artifact presentation/metadata visibility, and clarification/amendment placement | `schemaVersion`, guided/free progression, future-phase visibility, collapse behavior, revision-action visibility, DOM selectors, renderer modules, routes, arbitrary breakpoints, or host-specific layout code |
| `canvas-interactions` | Guided/free progression, future/completed-phase behavior, rerun enablement and confirmation, input retention and bounded phase-input guidance, phase-run confirmations, and revision-control visibility | `schemaVersion`, navigation visual style, phase order, artifact placement, command/skill identity, invocation arguments, filesystem paths, or new action types |
| `canvas-results` | One supported default result contract, phase-specific replacement/disable entries, allowed values/labels/tones/sources, clarification label/state, and deterministic progress enablement | `schemaVersion`, executable extractors, arbitrary formulas, multiple simultaneous phase tags, presentation-mode selectors, freshness, deduplication, or aggregation rules |
| `canvas-onboarding` | Workflow-slug behavior, `external`/`prompt`/`automatic` mode, and bounded approval/readiness/first-run/help/recovery copy | `schemaVersion`, generic presentation-mode selectors, captured dependency identity, prerequisite checks, source provenance, permission enforcement, partial-install behavior, or security disclosures |

Schema version 1 uses one canonical path for every supported setting:

| Capability | Canonical owner and path |
| --- | --- |
| Workflow names and description | `canvas-content.workflowListName`, `.itemName`, `.description` |
| General application copy | `canvas-content.copy.<declared-key>` |
| Semantic colors, typography, density, shape, branding | `canvas-theme.colors`, `.typography`, `.density`, `.shape`, `.brand` |
| Sidebar/tabs/single-page choice | `canvas-layout.navigation.style` |
| Pipeline direction | `canvas-layout.pipeline.orientation` |
| Phase-description visibility | `canvas-layout.phases.showDescriptions` |
| Artifact view and metadata | `canvas-layout.artifacts.presentation`, `.showMetadata` |
| Clarification/amendment placement | `canvas-layout.clarification.placement`, `.amendment.placement` |
| Guided/free workflow progression | `canvas-interactions.progression.mode` |
| Future/completed-phase behavior | `canvas-interactions.progression.showFuturePhases`, `.collapseCompletedPhases` |
| Rerun availability and generic rerun confirmation | `canvas-interactions.rerun.enabled`, `.requireConfirmation` |
| Input retention and phase-specific input guidance | `canvas-interactions.inputs.retainAfterRun`, `.phases.<phase-id>` |
| Branded phase-run confirmation | `canvas-interactions.phaseRunConfirmations.<phase-id>` |
| Revision-control visibility | `canvas-interactions.artifacts.showRevisionControls` |
| Results, clarification, and progress | `canvas-results.defaultResult`, `.phases`, `.clarification`, `.progress.enabled` |
| Workflow slug | `canvas-onboarding.workflowSlug.userProvided`, `.label`, `.helperText` |
| Runtime-package installation policy | `canvas-onboarding.installationMode` |
| Setup-specific copy | `canvas-onboarding.approvalCopy`, `.readinessCopy`, `.firstRunCopy`, `.helpCopy`, `.recoveryCopy` |

The default renderer remains responsive and follows host light/dark theme tokens,
but schema version 1 exposes no generic responsive object, color-mode selector,
setup-presentation selector, result-presentation selector, or initial-open selector.
Add such fields only when the default renderer implements at least two documented
behaviors and the test matrix covers them.

Sparse merge behavior is fixed:

- omitted fields retain the complete owner document's value;
- allowed scalar fields replace the scalar;
- allowed arrays replace the complete array; arrays are never appended or
  positionally merged;
- schema-declared maps keyed by stable IDs—such as phase confirmations and
  phase-specific result contracts—merge by ID and then by allowlisted leaf field;
- other objects accept only schema-declared leaf patches; unknown intermediate or
  leaf fields are rejected;
- `null` never means delete and is rejected unless a future schema explicitly
  defines it; disabling uses an explicit value such as `"enabled": false`;
- `schemaVersion` is owned by the complete document and is forbidden in sparse
  overrides;
- if a customer provider owns the complete category, the generator ignores that
  category's sparse override, emits a suppression warning in `result.json`, and
  performs no partial merge;
- after all permitted patches, the generator validates the complete category and
  then the final canvas experience profile.

| Level | Customer intent | Spec Kit mechanism | Composition | Generator behavior |
| --- | --- | --- | --- | --- |
| 1. Generation guidance and procedure | Use natural-language instructions to derive bounded generated-app experience—such as terminology, phase input guidance, or a branded pre-run confirmation—from the effective workflow; also change how generation is orchestrated, validated, or reported | Preset `type: command` targeting `speckit.canvas.generate`; it may explicitly invoke distinct support commands contributed by Canvas Design extensions | `prepend`, `append`, and `wrap` preserve the supported base workflow; `replace` assumes complete ownership | The effective command writes a sparse override draft; `canvas_generate.py prepare-override` validates it and writes the request-bound `command-override.json`, which materialization compiles into categories still using generator defaults. For `replace`, do not claim generator guarantees unless the replacement independently satisfies every contract |
| 2. Supported application experience | Change terminology, colors, typography, layout variants, interactions, results, or onboarding | Preset or eligible design-time extension providing named JSON files as `type: template` | `replace` per named configuration artifact; presets remain above extensions, and extension priority applies within the extension tier | Resolve, parse, schema-validate, and preserve the six category objects in `canvas-experience.json` |
| 3. Complete presentation replacement | Supply a different pipeline, phase, navigation, and artifact renderer | Preset or eligible design-time extension providing a replaceable renderer manifest as `type: template`, with adjacent renderer package files | `replace`; presets remain above extensions, and one renderer wins | Resolve manifest provenance, validate/copy package, and run conformance tests against the protected backend API |

The MVP does not expose a post-materialization customization script. Dynamic
supported values come from the composed generation command; static reusable values
come from named JSON templates; novel presentation comes from a complete renderer
replacement with packaged assets. Add a script artifact only in a future version
when a concrete deterministic generation-time transformation cannot be represented
by these three mechanisms.

### Canvas Design catalog and component lifecycle

The Wizard exposes two distinct catalog surfaces:

| Surface | Purpose | Component lifecycle |
| --- | --- | --- |
| Main Catalog | Select commands, skills, phases, and other runtime behavior for the generated pipeline | Existing Wizard behavior; runtime providers are captured in `pipeline.json` and must be available where the generated canvas runs |
| Canvas Design catalog in Generate | Select presets, extensions, and bundles that customize how the standalone canvas is generated | Existing Wizard Add/Remove behavior; components are installed in the Wizard project and their resolved output is materialized into the generated canvas |

Both surfaces use the same physical `.specify` project and the same Specify
composition state. The Wizard derives two UI classifications:

```text
.specify project and registry
  ├─ ordinary runtime packages
  │    └─ no canvas-design tag
  └─ Canvas Design packages
       └─ canvas-design tag in catalog and installed package manifest
```

Specify continues to resolve artifact precedence exactly as it does today.
Generation reads the effective runtime workflow from the artifact snapshot and
uses the tag classification to identify the generation behavior and resources
presented in Canvas Design. The tag itself does not isolate artifact stacks or
prevent composition.

Do not create a second or nested `.specify` project for Canvas Design. Physical
project isolation would introduce:

- ambiguous project-root and registry selection for CLI operations;
- duplicate installation, enablement, priority, update, and removal state;
- Copilot skill-discovery problems because generated skills must remain visible
  from the repository's effective `.github/skills/`;
- synchronization between the runtime project and the design project;
- an unavoidable merge step because generation still needs the runtime project's
  effective phases plus the design project's generator composition.

Tag-based Wizard classification provides the required user-facing separation
without splitting the repository's Spec Kit identity or requiring a new resolver
concept.

The lifecycle is:

```text
WIZARD — DESIGN TIME
──────────────────────────────────────────────────────────────

Main Catalog:
  • workflow extensions
  • phase command presets
  • runtime workflow bundles

Generate dialog — Canvas Design:
  • presentation presets
  • renderer presets
  • design-time extensions
  • Canvas Design bundles

                              │
                              │ Generate / Regenerate
                              ▼

GENERATED CANVAS
──────────────────────────────────────────────────────────────

Materialized:
  • canvas-experience.json
  • renderer package
  • branding and static assets
  • generated interaction behavior

Recorded as runtime requirements:
  • presets contributing to effective phase commands
  • extensions providing selected phase commands or skills

                              │
                              │ Open app and click Run
                              ▼

GENERATED-APP RUNTIME
──────────────────────────────────────────────────────────────

Uses:
  • baked-in presentation and interaction configuration
  • installed runtime command presets and workflow extensions
  • effective skills invoked by pipeline phases
```

Design-time components produce the application. Runtime components are used by the
application. Adding or removing a Canvas Design component changes subsequent
generation and regeneration; it does not restyle or replace the Wizard's current
workflow experience.

#### Generate-dialog Canvas Design catalog

Keep the existing Wizard Catalog focused on pipeline and runtime behavior. When the
user opens Generate, add a separate, independently scrollable Canvas Design area
using the same cards, search, source/trust presentation, and community confirmation
as the existing Catalog:

```text
Canvas Design
──────────────────────────────────────────────────────────────

Customize the appearance and design-time behavior of the generated
canvas application.

These presets, extensions, and bundles are installed in the Wizard
and applied while generating the application. Their resolved output
may be included in the generated application, but the design
components themselves are not automatically runtime dependencies.

[ Presets ] [ Extensions ] [ Bundles ]

Search Canvas Design components...
```

Reuse the existing Wizard Catalog loader, its current fixed plugin-owned catalog
source set, and its priority order. Do not add discovery of arbitrary
user-configured Spec Kit catalog sources in the initial release. Filter each tab to
catalog entries carrying the normalized catalog-level tag:

```text
canvas-design
```

Catalog tagging applies to presets, extensions, and bundles and controls discovery.
Installed presets and extensions must carry the same existing free-form tag in
their package manifests:

```yaml
extension:
  tags:
    - canvas-design
```

or:

```yaml
preset:
  tags:
    - canvas-design
```

Catalog metadata is not sufficient after installation because local and development
installs may not have catalog metadata. The Wizard therefore reads tags directly
from the installed `.specify/presets/<id>/preset.yml` and
`.specify/extensions/<id>/extension.yml` manifests. Installation already preserves
those manifests. If the installed-list JSON later exposes tags, the Wizard may use
that public field instead, but the initial release does not require an upstream
Specify change.

The `canvas-design` tag is classification metadata, not resolver metadata. The
canonical `speckit.canvas.generate` skill is published through the controlled
Copilot catalog, and customer Canvas Design presets/extensions intentionally
contribute to that existing artifact stack. Existing provenance distinguishes its
providers through installed package source/catalog metadata, `sourceId`, `lookupId`,
`manifestPath`, and the concrete skill `sourcePath`.

Therefore the existing artifact identity remains `(kind, name)` and
`artifact list --json` returns one `speckit.canvas.generate` command row with its
ordered provider stack. It does not return duplicate tag-qualified rows and does
not require a tag query parameter.

Because tags do not constrain composition, the Wizard and generator enforce the
Canvas Design package boundary they depend on:

- a package offered through Canvas Design must carry `canvas-design` in its
  catalog entry and installed manifest;
- a tagged design package may contribute `speckit.canvas.generate`, the named
  Canvas Design templates, a renderer, or explicitly invoked design-support
  commands;
- a tagged package that contributes a selected runtime phase command is rejected
  from the Canvas Design Add flow with a package-and-artifact error;
- an untagged package is not offered through Canvas Design, even if it happens to
  target a generation artifact;
- validation is Wizard/generator policy and does not change Specify mutation,
  resolution, or precedence behavior;
- authors publish separate packages when they need both design-time presentation
  and runtime phase behavior.

The Canvas Generator Extension's catalog entry also carries `canvas-design`. It is
always the first extension displayed:

```text
Canvas Generator Extension
Required to generate a standalone canvas.

Added
```

The normal Wizard Catalog excludes catalog entries tagged `canvas-design`, while
the Canvas Design catalog includes only those entries. After installation, the
Wizard joins the installed package IDs returned by Specify with tags read from
their installed manifests:

- Main Catalog, Phases, and runtime command pickers omit installed packages tagged
  `canvas-design`;
- Generate and Canvas Design component state include installed packages tagged
  `canvas-design`;
- the Composition page may show the full effective stacks while marking or
  filtering design-time providers according to the surface's existing UX;
- the generation request carries one Specify-resolved artifact snapshot plus the
  deterministic package-tag classification captured by the Wizard.

#### Required Canvas Generator Extension setup

Treat the Canvas Generator Extension like the Wizard's existing default
`copilot-sub-agents` setup rather than installing it lazily from the Generate
button:

- include it in the Environment page's default component installation step;
- install it only when it is not already installed;
- declare the Wizard release's required generator version range in the same
  first-party setup metadata used for other required components;
- use the standard Spec Kit installed-version and catalog-update state to detect an
  outdated generator, rather than implementing a generator-specific negotiation
  protocol;
- when the installed version does not satisfy the required range, show the standard
  explicit Update/Retry action in Environment and keep Generate unavailable until
  the ordinary extension update succeeds; do not silently update project
  composition;
- use the trusted first-party installation path without community confirmation;
- install it explicitly at extension priority `100` rather than relying on the CLI
  default;
- if it is already installed but disabled or at another priority, enable it and
  run
  `specify extension set-priority pipeline-canvas-generator 100`
  rather than reinstalling it;
- reload the current session's skills after installation through the existing
  Environment reload step;
- derive completion from live installed/readiness state so an externally removed
  extension makes Environment incomplete again;
- show installation progress, failure, and Retry in Environment rather than in the
  Generate dialog.

The Environment sequence remains:

```text
Verify Copilot plugin
  -> Verify Specify CLI
  -> Initialize project
  -> Install missing default presets and required extensions
       • copilot-sub-agents preset
       • Canvas Generator Extension
  -> Reload skills
  -> Report ready
```

Do not reinstall either default when a compatible version is already present. If
Canvas Generator installation or update fails, Environment remains incomplete and
its existing Retry behavior re-runs the standard missing/outdated-component step.
The versioned generation request and result schemas still reject unsupported
payloads defensively, but they are not a separate package-update mechanism.

Spec Kit resolves artifacts in this tier order:

```text
project override
  -> presets
  -> extensions
  -> Spec Kit core
```

Numeric priority is compared only within the preset tier or within the extension
tier; lower numbers have higher precedence. Therefore:

- every customer preset remains above the Canvas Generator Extension regardless of
  numeric priority and may `replace`, `prepend`, `append`, or `wrap` its artifacts;
- customer extensions at the normal default priority `10` may replace shared
  non-command templates supplied by the generator extension;
- the Canvas Generator Extension at priority `100` remains the deliberate fallback
  extension provider;
- priority `1` would incorrectly make the generator dominate customer extensions;
- implicit priority `10` would create brittle alphabetical tie-breaking with normal
  customer extensions.

Install it after project initialization with:

```text
specify extension add pipeline-canvas-generator --priority 100
```

using the appropriate catalog, URL, or development source form. Do not rely on
`specify init --extension`, because that path does not expose per-extension
priority and would install at the default `10`.

Extensions may not override another extension's command by declaring the same
command name; command and alias collisions are rejected. Customer composition of
`speckit.canvas.generate` must therefore use a preset command artifact. A customer
extension may contribute distinct design-time commands or higher-precedence shared
non-command templates.

The extension has no Remove action in Canvas Design. The Canvas Design catalog shows
it as Added and Required for transparency, but Environment owns its installation and
readiness.

The Generate button performs no generator bootstrap. It uses the Environment
readiness state:

```text
Canvas Generator ready
  -> open Generate dialog

Canvas Generator missing or failed
  -> do not open a partially functional dialog
  -> direct the user to the Environment page's existing setup/retry action
```

This keeps installation progress, errors, and retries in the Wizard surface already
responsible for default preset and extension setup. The Canvas Design catalog still
shows the generator as Added and Required for transparency.

#### Add and Remove behavior

Match the current Wizard Catalog instead of introducing deferred checkbox selection
or a mixed batch:

```text
Add
  -> request community confirmation when required
  -> install exactly one component immediately
  -> use the existing Wizard Catalog success path
  -> reload current-session skills when the installed preset/extension set changes
  -> refresh the affected catalog and effective composition
  -> display Added

Remove
  -> remove exactly one component immediately
  -> use the existing Wizard Catalog success path
  -> reload current-session skills when the installed preset/extension set changes
  -> refresh the affected catalog and effective composition
  -> display Add

Generate / Regenerate
  -> perform no package-management batch
  -> perform no package-management skill reload
  -> resolve the currently enabled Canvas Design components
  -> generate the application
```

The normal card states are:

```text
Contoso Canvas Design
Adds Contoso branding and generated interactions.

[Add]
```

and:

```text
Contoso Canvas Design
Adds Contoso branding and generated interactions.

Added                                             [Remove]
```

`Added` means installed in the Wizard's current `.specify` project and active in
design-time composition. Remove uses the existing Spec Kit removal flow for that
primitive. A later Add installs it again. Bundle removal follows existing bundle
ownership and component-removal rules.

Because Add and Remove take effect immediately, Cancel closes the Generate dialog
without generating but does not roll back completed component changes. This matches
the existing Catalog model and avoids pending selection, approval persistence,
mixed add/remove batches, rollback, and scoped per-generation resolution.

Community presets, extensions, and bundles use the existing confirmation UI before
Add proceeds. No approval fingerprint, durable approval receipt, or catalog-change
revalidation is introduced. If installation fails, the card remains Add and shows
the actionable failure. If removal fails, the card remains Added. Generate is
disabled while an Add or Remove operation is active.

Preset and extension operations reuse the current installed-ID change detection and
automatic session reload behavior. Bundle operations reuse the current bundle flow,
including its explicit skill reload and re-listing of contributed presets and
extensions. Do not defer either reload path until Generate.

Reuse the current Wizard community-confirmation implementation unchanged in the
initial release, including its existing bundle treatment and wording. A
bundle-specific confirmation redesign or expanded bundle component disclosure is
outside this work.

#### Design-time extension commands

A `canvas-design` extension may add a new command to the Wizard, for example:

```yaml
provides:
  commands:
    - name: speckit.contoso-canvas.validate-brand
      file: commands/validate-brand.md
      description: Validate generated output against Contoso brand requirements
```

The catalog tag makes the extension discoverable in Canvas Design; it does not
automatically execute every command the extension provides. A design-time command
must have an explicit invocation path, initially either:

- an action explicitly exposed by the Generate experience; or
- the effective `speckit.canvas.generate` command instructing the agent to invoke
  it.

Do not introduce a generic automatic hook system for every command contributed by
a tagged extension in the initial release.

Canvas Design commands remain available to Copilot after skill reload so the
generation command can invoke them explicitly, but the Wizard's Phases tab and
runtime command picker filter out commands supplied by packages whose installed
manifest carries `canvas-design`. Consequently these commands never appear as
user-selectable workflow phases. The Composition page may omit or label those
providers according to its runtime-focused UX without changing the underlying
Specify artifact result.

#### Design and runtime package boundary

At design time, the Wizard invokes only the Canvas Generator Extension's
`speckit.canvas.generate` command. It does not invoke selected workflow phase
skills such as `speckit.specify`, `speckit.plan`, or
`speckit.security-review`.

```text
Design time
  -> invoke speckit.canvas.generate
  -> resolve Canvas Design templates and renderer
  -> inspect effective phase definitions and providers
  -> compile phase mappings and runtime dependencies
  -> generate pipeline.json, canvas-experience.json, and the standalone canvas

Generated-app runtime
  -> user clicks a phase Run action
  -> invoke that phase's captured effective skill
  -> execute its runtime preset composition
```

A Canvas Design preset does not override or execute a workflow phase command. Its
named JSON templates configure how that phase is represented and interacted with
in the generated application. The generator may inspect the effective phase
command to derive supported defaults and record providers, but inspection must not
execute the phase skill or perform its substantive work.

A Canvas Design preset may instead or additionally compose
`speckit.canvas.generate` with natural-language generation guidance. That composed
command runs only during generation and produces a validated sparse experience
override; it is not a runtime dependency of the generated application.

A Canvas Design extension may instead contribute additional design commands,
non-command templates, or a renderer package. Installing the extension makes its
commands available after skill reload, but does not run them automatically. The
effective generation command or an explicit Generate action invokes a design
command when that behavior is required.

A runtime preset separately composes the phase command that the generated
application invokes later. Customers need both packages only when they are
customizing both surfaces:

| Customer intent | Required component |
| --- | --- |
| Change only the phase's agent instructions or output behavior | Runtime preset |
| Change only the generated presentation or supported pre-dispatch interaction for the phase | Canvas Design preset or extension |
| Add a reusable validation, asset-building, or other explicitly invoked generation command | Canvas Design extension |
| Change both the generated presentation and the phase instructions | Separate Canvas Design component and runtime preset |

Prefer separate packages when a customer needs both presentation and runtime
customization:

```text
copilot-contoso-canvas-design
  -> selected through Canvas Design
  -> supplies canvas-interactions
  -> materialized into canvas-experience.json
  -> not required by the generated app

copilot-contoso-security-review
  -> selected through the main Catalog
  -> wraps speckit.security-review
  -> captured as a runtime dependency
  -> required where the generated app runs
```

This separation prevents removing or disabling a design package from also removing
runtime behavior required by the generated pipeline. Canvas Design bundles should
initially contain design-time components only. Every preset and extension included
by a Canvas Design bundle must itself carry the `canvas-design` tag; bundle-level
tags do not propagate to their components. Do not show or install a bundle through
Canvas Design when any included component is untagged or contributes runtime phase
behavior.

#### Generated-app catalog filtering

The generated application's own Catalog must exclude every preset, extension, and
bundle whose catalog entry contains `canvas-design`. Apply the exclusion before
search, sorting, pagination, counts, recommendations, update suggestions, and
installation actions. This also hides the Canvas Generator Extension.

Generated applications may explain:

> Canvas Design components are applied through the Canvas Wizard when generating
> or regenerating this application.

Do not expose design-time components as runtime-installable items, because adding
them after generation would not rerun validation, rebuild `canvas-experience.json`,
replace the renderer, update the generation receipt, or rebuild the disposable
generated extension.

### Level 1: generation procedure through command Markdown

The Canvas Generator Extension owns the base `speckit.canvas.generate` command.
Presets may modify that command using current command composition. Canvas Design
extensions may add distinct support commands that this effective command invokes;
they do not redeclare the generator command.

Appropriate uses:

- derive a supported `canvas-interactions.phaseRunConfirmations` entry, including
  bounded title, description, confirm-label, and cancel-label text, from
  natural-language generation guidance;
- when phase-input configuration is not explicitly provided, derive the input
  label, helper text, optionality, or fixed prefix/suffix guidance from the final
  effective skill instructions, including preset and extension composition;
- require the generated result to report which experience configuration and
  renderer were selected;
- require post-generation accessibility, mobile, and capability verification;
- change how unsupported workflows, invalid configuration, and regeneration
  conflicts are explained to the user.

Inappropriate uses:

- encoding a large color palette in prose;
- asking the agent to hand-edit generated CSS or JavaScript;
- redefining phase order selected in the Wizard;
- bypassing deterministic generator validation.
- instructing the command to inject arbitrary source, a novel button, dialog, form,
  or other unsupported control into the generated canvas. Requesting the supported
  bounded phase confirmation through `command-override.json` is allowed.

#### Command behavior versus generated presentation

Command composition changes agent behavior only after the generated canvas invokes
the effective phase skill. A command override may use existing Copilot interactions
such as `ask_user` to collect dynamic or unforeseen information before substantive
skill work begins:

```text
User clicks Run
  -> generated canvas invokes the effective skill
  -> composed command instructions begin
  -> skill calls ask_user
  -> Copilot displays its standard question UI
  -> skill continues
```

This requires no new generated-canvas presentation support, but the interaction is
owned by the Copilot host rather than the active canvas renderer. It occurs after
skill dispatch and does not inherit the generated canvas's theme, branding, modal
components, or layout.

Command Markdown cannot add or intercept generated-canvas UI merely by instructing
the agent to display it. The agent does not read the command until after the canvas
has dispatched the skill. Therefore:

```text
Command override
  -> changes behavior after skill invocation
  -> may use ask_user for dynamic questions
  -> cannot add native canvas controls or block dispatch itself

Canvas Design configuration or renderer
  -> changes generated application presentation
  -> may implement supported native UI before skill invocation
  -> is resolved and materialized during generation
```

Preset authors who need a native pre-dispatch confirmation use the supported
`canvas-interactions` contract. Authors who need open-ended, repository-dependent,
or conditional questioning use command composition and `ask_user`. UI behavior not
supported by standard configuration requires renderer replacement rather than a
prose convention embedded in command Markdown.

Example:

```yaml
provides:
  templates:
    - type: command
      name: speckit.canvas.generate
      file: commands/speckit.canvas.generate.md
      strategy: wrap
```

```markdown
When deriving phase input guidance, use the workflow's domain terminology and the
final effective skill instructions, including applicable preset and extension
layers. Derive only values not supplied by the resolved JSON configuration. Keep
guidance about content only; do not add slug, path, or workspace instructions.

{CORE_TEMPLATE}

After generation, report the applied experience categories, renderer, and results
of desktop, mobile, and accessibility validation.
```

### Level 2: supported UX through replaceable JSON configuration

Current Spec Kit supports explicitly declared UTF-8 JSON/YAML files as
`type: template`; manifest-declared templates are not restricted to Markdown. The
Canvas Generator Extension should provide a small set of named default JSON
templates. A preset replaces only the category it owns.

Recommended artifacts:

| Artifact name | Responsibility |
| --- | --- |
| `canvas-content` | Workflow terminology, descriptions, general labels, empty-state text, and non-setup workflow recovery copy |
| `canvas-theme` | Semantic colors, typography, spacing density, shape, elevation, and branding including default, custom, or hidden logo |
| `canvas-layout` | Navigation visual style, pipeline orientation, phase-description visibility, artifact presentation/metadata, and clarification/amendment placement |
| `canvas-interactions` | Guided/free progression, future/completed-phase behavior, rerun behavior, phase inputs, confirmations, and revision-control visibility |
| `canvas-results` | Result labels/sources/tones, clarification state, deterministic progress, and workflow summaries |
| `canvas-onboarding` | Workflow-slug behavior, launch-time installation mode, approval copy, readiness, first-run, help, and setup-recovery copy |

Splitting the profile into named artifacts allows independent presets to replace
different categories without textually merging JSON. The generator combines the
resolved category documents without renaming or redistributing their fields. It
writes them under the same six keys in `canvas-experience.json`. The generated
backend and renderer consume that file directly.

Example theme preset:

```yaml
provides:
  templates:
    - type: template
      name: canvas-theme
      file: config/canvas-theme.json
      strategy: replace
```

```json
{
  "schemaVersion": 1,
  "colors": {
    "brand": "#102A43",
    "accent": "#00A4B4",
    "surface": "#FFFFFF",
    "text": "#102A43",
    "focus": "#0067B8"
  },
  "typography": {
    "family": "segoe-system",
    "scale": "standard"
  },
  "density": "compact",
  "shape": {
    "radius": "small",
    "elevation": "none"
  },
  "brand": {
    "logo": {
      "mode": "default",
      "alt": "Spec Kit"
    }
  }
}
```

Rules:

- Use `strategy: replace`; current prepend/append/wrap behavior is textual and is
  not an appropriate structured merge for JSON.
- The extension provides a complete default for every named artifact.
- Each artifact has an extension-owned JSON Schema and version.
- Reject unknown fields, invalid enum values, unsafe URLs, inaccessible colors, and
  unsupported combinations.
- Configuration selects only renderer capabilities implemented and tested by the
  active renderer.
- Record the resolved source/version/hash of each category in generated provenance.

Logo configuration uses one bounded contract:

```json
{
  "brand": {
    "logo": {
      "mode": "asset",
      "file": "assets/contoso-logo.webp",
      "alt": "Contoso"
    }
  }
}
```

- `default` uses the Spec Kit logo sourced from
  `https://raw.githubusercontent.com/github/spec-kit/main/media/logo_large.webp`.
  The Canvas Generator Extension vendors a versioned copy of that image; generated
  canvases do not fetch it from the network at runtime.
- `asset` requires a preset-packaged relative image file. The generator resolves it
  relative to the effective `canvas-theme` provider, validates and hashes it, then
  copies it into the generated renderer assets.
- `none` renders no logo and reserves no empty logo space.

For `asset`, require a confined regular file, reject symlinks and path escapes,
enforce bounded dimensions and bytes, and initially accept only PNG, JPEG, and WebP.
Require nonempty bounded alt text for `default` and `asset`; ignore `file` and `alt`
for `none`. Do not support authenticated or runtime remote logo URLs in the initial
release.

This is the primary mechanism for changing the default shared presentation layer.

### Level 3: complete presentation replacement through a renderer package

Customers needing a wholly different pipeline visualization, phase visualization,
navigation structure, or artifact experience should replace the renderer rather
than force those differences through configuration flags.

The renderer is a true plugin boundary, not a copy of PR #32's current monolithic
`ui/app.js`. Refactor the existing shared presentation into:

```text
Canvas host
  +-- protected Canvas Runtime API adapter
  +-- validated standard experience configuration
  +-- active renderer package
        +-- mount entry point
        +-- static styles and assets
```

Both hosts implement the same versioned API:

- the Wizard uses a Wizard host adapter for isolated renderer preview and
  conformance surfaces;
- generated canvases use the standalone generated-runtime adapter.

The API contract is shared; the renderer implementation is not. The Wizard's live
workflow experience remains a Wizard-owned resource and never imports or loads the
generator extension's renderer. The Canvas Generator Extension owns the default
renderer copied into generated applications. Removing, disabling, repairing, or
updating the generator can affect Generate/Regenerate readiness, but cannot affect
the Wizard's live workflow UI.

Canvas Design configuration and replacement renderers affect generated output
only. The Wizard may mount the effective generated renderer in an isolated
Generate preview or conformance surface through its adapter, but selection must not
replace or restyle the Wizard's live workflow experience.

The Canvas Generator Extension provides a default named template:

```yaml
provides:
  templates:
    - name: canvas-renderer
      file: renderer/renderer.json
      description: "Default generated-canvas renderer"
```

A preset replaces it:

```yaml
provides:
  templates:
    - type: template
      name: canvas-renderer
      file: renderer/renderer.json
      strategy: replace
```

Preset package:

```text
copilot-canvas-decision-board/
  preset.yml
  renderer/
    renderer.json
    mount.mjs
    components/
      pipeline.mjs
      phase-view.mjs
      artifact-view.mjs
    styles.css
    assets/
      logo.svg
```

Example manifest:

```json
{
  "schemaVersion": 1,
  "id": "contoso-decision-board",
  "runtimeApiVersion": 1,
  "entrypoint": "mount.mjs",
  "export": "mountCanvas",
  "files": [
    "mount.mjs",
    "components/pipeline.mjs",
    "components/phase-view.mjs",
    "components/artifact-view.mjs",
    "styles.css",
    "assets/logo.svg"
  ],
  "requires": [
    "phase-execution",
    "artifact-preview",
    "setup"
  ]
}
```

The protected host loads the entry module and calls one intuitive contract:

```javascript
export async function mountCanvas({
  root,
  api,
  config
}) {
  // The renderer owns all presentation beneath root.
}
```

- `root` is the renderer-owned DOM mount point.
- `api` implements the versioned Canvas Runtime API.
- `config` is the complete standard configuration resolved from
  `canvas-content`, `canvas-theme`, `canvas-layout`, `canvas-interactions`,
  `canvas-results`, and `canvas-onboarding`, with extension defaults applied.

The renderer may use all standard configuration, use only the categories it needs,
or leave every category at extension-provided defaults. Replacing the renderer does
not require replacing existing configuration presets.

A custom renderer may add new presentation elements such as a risk panel, domain
dashboard, alternate workflow map, organization links, or custom artifact
summaries by deriving them from the standard runtime state and configuration. The
initial release does not add a separate renderer-specific configuration system.
Renderer-specific configuration may be introduced later through a versioned field
if concrete customer scenarios require it.

The Canvas Runtime API is explicitly versioned and documented. It provides:

- immutable workflow metadata, phases, project-level artifacts, and capabilities;
- current workflow items, phase state, result tags, progress, and clarification
  state;
- setup readiness and protected dependency-review facts;
- subscriptions or refresh notifications;
- actions for phase execution, artifact viewing, clarification/amendment,
  workflow creation/deletion where supported, and setup approval;
- normalized success and error result shapes.

Renderers do not call private HTTP routes, depend on host-specific DOM IDs, inspect
backend persistence, or recalculate protected runtime state. Host adapters hide
whether the renderer is running inside the Wizard or a generated canvas.

The host reports its available capabilities through the API. The renderer manifest
declares only the capabilities it requires. Loading fails explicitly when a host
cannot satisfy a requirement. Do not expose a boolean manifest field for every
optional UI feature.

The JSON manifest is the resolvable Spec Kit artifact. Renderer files are ordinary
adjacent files carried in the installed preset package. Shared resolution:

1. Resolves the effective `canvas-renderer` template and its source provenance.
2. Parses and validates the manifest.
3. Resolves every listed file relative to the manifest's package directory.
4. Rejects escaping paths, undeclared files, symlinks, unsupported types, and size
   violations.
5. Resolves the complete standard experience configuration.
6. Verifies that the host satisfies the renderer's declared requirements.
7. Runs the renderer conformance suite.

The generator resolves the effective package, copies it into staging, and publishes
it with the protected generator-owned backend. The Wizard loads the canonical
default renderer for its own workflow experience and may load a customer renderer
only in an isolated preview or validation surface.

Only one renderer is active. Renderer composition is replacement, not textual
merging. A renderer may internally reuse the default renderer's documented
components, but the generator still validates and publishes one complete package.

The renderer may replace:

- the complete application UI beneath the protected host mount point;
- pipeline and phase visualization;
- navigation and page organization;
- artifact presentation;
- status, loading, empty, error, and completion states;
- frontend styling, branding, responsive design, and client-side presentation.

The renderer may not replace:

- the generated extension backend;
- workflow and setup state calculation;
- phase execution dispatch;
- artifact path authorization;
- host, origin, token, and filesystem security;
- setup/install approval enforcement;
- ownership, regeneration, whole-target replacement/recovery, or removal logic.

The Canvas Runtime API is the supported compatibility and capability interface, but
same-process renderer JavaScript is not a security sandbox. Renderer packages are
trusted executable code under the catalog installation decision. The protected
backend must still authorize every action, confine every file path, and avoid
exposing unrestricted filesystem, command execution, credentials, or private
maintenance routes to renderer code. Renderer conformance checks catch accidental
contract violations; they are not a substitute for backend authorization against a
malicious renderer.

Required setup disclosures are supplied as protected structured data. A renderer
may choose their visual treatment and use customizable approval copy, but it must
display the complete dependency list, source/trust facts, required community
warning, and all-or-nothing actions. Conformance testing rejects a renderer that
hides or changes those semantics.

The default renderer extraction must split PR #32's current monolithic UI into:

- a host-independent state/view model;
- the documented Canvas Runtime API client interface;
- reusable presentation modules for workflow collection, pipeline, phase,
  artifact, clarification, amendment, and setup experiences;
- one `mountCanvas` composition root;
- renderer-owned CSS and assets without host-specific selectors.

Use a focused test strategy:

- run one Canvas Runtime API contract suite against both host adapters;
- run every renderer against a mock conforming API;
- run the generator's default renderer end-to-end in a generated canvas and in the
  Wizard's isolated preview/conformance surface;
- run one sample replacement renderer end-to-end as proof of replacement;
- test the Wizard's live renderer independently under the Wizard's own release
  suite;
- verify contract compatibility, required setup disclosures, actions, artifact
  behavior, and accessibility semantics without requiring visual or implementation
  equality between the two products.

A generator-renderer change cannot ship if it regresses generated output or the
isolated Wizard preview/conformance host. It cannot silently change the Wizard's
live renderer. Do not require every third-party renderer to run a full
host-by-renderer cross-product.

If a customer needs to replace both frontend and backend, that is a separate canvas
extension, not a preset customization.

### PR #32 customer customization scenarios

The following scenarios are grounded in behavior and files already present in PR
#32.

| Customer scenario | PR #32 surface today | Recommended customization level |
| --- | --- | --- |
| Set the canvas name, workflow collection heading, and description for one generated canvas | Generate dialog `displayName`, `workflowListName`, and `description` | Instance request overlay; a Canvas Design preset may still provide reusable defaults |
| Let users provide a workflow slug or rely on Spec Kit/Copilot to choose it | Generate dialog `userProvidesSlug`, `ui/workflow-slug.mjs` | Instance request overlay at `canvas-onboarding.workflowSlug.userProvided`; detailed field copy remains preset-owned |
| Request all-or-nothing launch approval or automatically install the administrator-authorized captured dependencies | Generate dialog `requireInstallationApproval`, `approval-runtime.mjs`, setup UI | Instance request overlay mapped to `canvas-onboarding.installationMode: prompt | automatic`; `external` and custom setup copy remain preset-owned |
| Use domain result states such as Go/Revise/Stop or Approved/Changes requested/Rejected | Generate dialog `resultLabels`, `artifact-review.mjs`, badges/summary UI | `canvas-results` JSON |
| Enable, disable, rename, or visually emphasize clarification status | Generate dialog `clarificationTag`, clarification runtime/UI | `canvas-results` JSON |
| Change phase input label, helper text, optionality, or fixed prefix/suffix arguments | `workflow-config.json.phaseInputs` and `phaseArguments`, `workflow-adapter.mjs` | JSON configuration when fixed; generation-command guidance when derived from effective skill semantics |
| Change colors, typography, spacing, card shape, or basic branding | Hard-coded copied `shared-workflow-ui/workflow-theme.css` | `canvas-theme` JSON interpreted by the generator-owned default renderer |
| Change horizontal/vertical stepper, sidebar/tabs, Constitution placement, or desktop/mobile arrangement | Copied `stepper.mjs`, `ui/app.js`, `ui/command-views.mjs`, shared CSS | `canvas-layout` JSON for supported variants |
| Change whether future phases are visible, completed phases collapse, reruns require confirmation, or inputs persist | Copied generated UI/runtime behavior | `canvas-interactions` JSON for supported variants |
| Display a branded confirmation before a phase skill is invoked, while separately customizing the invoked skill | No generic pre-run UI contract; Run currently dispatches the skill after fixed setup/rerun checks | Level 1 natural-language generation guidance may derive the bounded confirmation through `command-override.json`; Level 2 may instead replace `canvas-interactions` for exact reusable configuration. A separate runtime preset composes the phase command |
| Change inline artifact viewing, metadata visibility, clarification/amendment placement, or supported responsive artifact arrangement | Copied artifact viewer, clarification, and amendment modules | `canvas-layout` JSON |
| Use a completely different pipeline visualization, phase cards, navigation, and artifact UI | Entire copied `generated-canvas-template/ui/` plus `shared-workflow-ui/` presentation | Replace `canvas-renderer` manifest and renderer package |
| Use the bundled Spec Kit logo, a preset-packaged customer logo, or no logo | Current generated package has no general logo setting | `canvas-theme` JSON using `brand.logo.mode: default | asset | none`; custom asset resolved relative to the theme provider |
| Add other renderer-specific packaged static assets | Current generated package has no general preset asset mechanism | Renderer package for renderer-owned assets; pre-transform assets before packaging because generation-time transformation scripts are deferred from the MVP |

The first three rows are the compact instance settings retained from PR #32. They
are explicit structured request values rather than preset requirements. Result and
clarification settings are intentionally removed from the common form and continue
through generator defaults or Canvas Design presets.

The next rows turn the currently copied and protected shared presentation layer
into a configurable renderer with a bounded set of supported variants.

The final full-renderer scenario preserves the PR #32 backend and security model but
replaces the copied presentation implementation.

#### Canonical SDD canvas coverage

The compact request is sufficient for the canonical SDD canvas's common
customization:

- **Name:** `Spec-Driven Development`;
- **Workflow header:** `Features`;
- **Description:** an explicit SDD description or the phase-derived
  `Specify → Clarify → Plan → Tasks → Analyze → Checklist → Implement` default;
- **Allow custom slug:** off, preserving Specify/Copilot-owned feature-directory
  selection;
- **Require installation approval:** on when the generated app should review the
  complete missing runtime dependency set before installation.

Do not add more common fields for SDD. Its Constitution surface, active feature,
done/next/available/stale phase pills, artifact preview, targeted clarification,
rerun behavior, task progress, and transient Analyze behavior are generator-owned
runtime capabilities derived from the captured pipeline and artifact contracts.

The only canonical SDD differences not covered by the compact request are
domain-specific result presentation: a positive `Clarified` state, checklist
status, and implementation outcome labels. Supply those through an SDD Canvas
Design preset or generator-owned SDD result contracts. An exact numeric checklist
count requires a protected, schema-supported runtime count fact; otherwise use a
semantic `Checklist created` result rather than adding a common setting or
renderer-specific inference.

#### Complete pre-run confirmation through command guidance or template replacement

**MVP decision:** support only a simple confirmation interaction before phase
dispatch. This proves that a design-time preset can add generated UI before a
separately customized runtime skill executes without introducing a general form
platform. The preset may configure bounded title, description, confirm-label, and
cancel-label text for a phase. Confirm dispatches the captured effective phase
skill; Cancel leaves the phase unchanged.

Do not include preset-configurable text fields, selects, checkboxes, validation
rules, conditional fields, answer persistence, or mapping form values into skill
arguments in the initial release. Continue to use the phase command's `ask_user`
interaction for dynamic or unforeseen questions after dispatch. Add a broader
native form contract only when concrete field-collection scenarios justify it.

The common Level 1 path uses natural-language command composition:

```yaml
schema_version: "1.0"

preset:
  id: "copilot-contoso-canvas-guidance"
  name: "Copilot Contoso Canvas Guidance"
  version: "0.1.0"
  description: "Adds Contoso generation guidance for generated canvases"
  tags:
    - canvas-design

provides:
  templates:
    - type: command
      name: speckit.canvas.generate
      file: commands/speckit.canvas.generate.md
      strategy: wrap
```

```markdown
When generating this canvas, add the supported pre-run confirmation for the
security-review phase:

- title: Start Contoso security review?
- description: This review will inspect the selected project for security risks
  and produce a findings report.
- confirm label: Start review
- cancel label: Cancel

Represent this only through the supported command-derived
canvas-interactions.phaseRunConfirmations override. Do not edit generated source or
change the authoritative phase order.

{CORE_TEMPLATE}
```

During the effective generation command, Copilot writes the derived `categories`
object to `command-override-draft.json`. The extension-owned
`canvas_generate.py prepare-override` operation validates it and produces the
following finalized, request-bound contract:

```json
{
  "schemaVersion": 1,
  "requestSha256": "<digest>",
  "categories": {
    "canvas-interactions": {
      "phaseRunConfirmations": {
        "security-review": {
          "title": "Start Contoso security review?",
          "description": "This review will inspect the selected project for security risks and produce a findings report.",
          "confirmLabel": "Start review",
          "cancelLabel": "Cancel"
        }
      }
    }
  }
}
```

The generator validates and merges this sparse value because
`canvas-interactions` still comes from the Canvas Generator Extension.

For customers that need exact, byte-stable, reusable configuration rather than
natural-language derivation, the Level 2 design-time preset instead replaces the
complete named template:

```yaml
schema_version: "1.0"

preset:
  id: "copilot-contoso-canvas-design"
  name: "Copilot Contoso Canvas Design"
  version: "0.1.0"
  description: "Adds Contoso presentation behavior to generated canvases"
  tags:
    - canvas-design

provides:
  templates:
    - type: template
      name: canvas-interactions
      file: config/canvas-interactions.json
      strategy: replace
```

Its catalog entry carries:

```json
{
  "id": "copilot-contoso-canvas-design",
  "tags": ["canvas-design"]
}
```

The complete replacement `canvas-interactions.json` includes:

```json
{
  "schemaVersion": 1,
  "progression": {
    "mode": "guided",
    "showFuturePhases": true,
    "collapseCompletedPhases": false
  },
  "rerun": {
    "enabled": true,
    "requireConfirmation": true
  },
  "inputs": {
    "retainAfterRun": true,
    "phases": {}
  },
  "phaseRunConfirmations": {
    "security-review": {
      "title": "Start Contoso security review?",
      "description": "This review will inspect the selected project for security risks and produce a findings report.",
      "confirmLabel": "Start review",
      "cancelLabel": "Cancel"
    }
  },
  "artifacts": {
    "showRevisionControls": true
  }
}
```

The runtime preset remains a separate package selected through the main Catalog:

```yaml
schema_version: "1.0"

preset:
  id: "copilot-contoso-security-review"
  name: "Copilot Contoso Security Review"
  version: "0.1.0"
  description: "Applies Contoso policy to the security-review skill"

provides:
  templates:
    - type: command
      name: speckit.security-review
      file: commands/speckit.security-review.md
      strategy: wrap
```

```markdown
Apply Contoso security and data-handling policy throughout this review.

The generated canvas has already displayed the required review disclosure and
received confirmation from the user. Do not ask the user to confirm it again.

{CORE_TEMPLATE}

After completing the standard review:

1. Classify findings using Contoso severity levels.
2. Identify findings requiring security-team escalation.
3. Produce the Contoso findings summary.
```

The lifecycle is:

```text
DESIGN TIME

Add copilot-contoso-canvas-guidance in Canvas Design
  -> compose the effective speckit.canvas.generate command
  -> during generation, normalize its natural-language request into the sparse
     canvas-interactions command override
  -> validate and compile the confirmation into canvas-experience.json

OR add copilot-contoso-canvas-design in Canvas Design
  -> install and enable it in the Wizard
  -> resolve the exact replacement canvas-interactions template
  -> compile confirmation into canvas-experience.json

Select copilot-contoso-security-review in the main Catalog
  -> compose the effective security-review skill
  -> inspect and capture it as a generated-app runtime dependency
  -> do not invoke the security-review skill during generation

RUNTIME

Click Run on security-review
  -> generated renderer displays the baked-in confirmation
  -> Cancel leaves the phase unchanged
  -> Start review invokes the effective security-review skill
  -> the wrapped Contoso command executes
```

Neither Canvas Design preset is required at generated-app runtime. The runtime
preset is. For dynamic or unforeseen questions after invocation, the runtime
command may use Copilot's existing `ask_user` interaction without adding more
renderer configuration.

### Robust, customizable replacement for PR #32 result tags

Preserve PR #32's user-visible outcome—an optional configured result tag after a
phase plus independent clarification reporting—while replacing its separate
post-phase Copilot reviewer with explicit, bounded result sources.

The generated app distinguishes:

1. **Phase state** — fixed runtime state such as ready, running, complete, stale,
   blocked, or failed.
2. **Phase result tag** — at most one optional configured domain result for a phase,
   such as `Decision = Go`, `Verification = Failed`, or
   `Implementation = Partial`.
3. **Phase progress** — an optional deterministic numeric metric such as completed
   implementation tasks.
4. **Clarification signal** — independent detection and presentation of unresolved
   clarification markers.

Result tags are configured explicitly. When neither the effective generation
command nor the resolved `canvas-results` template supplies result configuration,
the generator does not inspect skill prose and invent labels. The phase still has
normal state, progress, and clarification behavior. The generator extension's base
`canvas-results.json` therefore enables standard clarification/progress behavior
but contains no `defaultResult` and no phase-specific result entries.

#### Global default with per-phase overrides

`canvas-results` may define one default result contract that applies to every phase,
matching PR #32's global label behavior. A phase-specific entry may replace that
default for one stable command, or disable the result tag for that phase.

```json
{
  "schemaVersion": 1,
  "defaultResult": {
    "label": "Result",
    "values": [
      {
        "id": "implemented",
        "label": "Implemented",
        "tone": "positive"
      },
      {
        "id": "partial",
        "label": "Partially implemented",
        "tone": "attention"
      },
      {
        "id": "not-implemented",
        "label": "Not implemented",
        "tone": "critical"
      }
    ],
    "source": {
      "from": "phase-report"
    },
    "summary": true
  },
  "phases": {
    "speckit.assess.decide": {
      "label": "Decision",
      "values": [
        {
          "id": "go",
          "label": "Go",
          "tone": "positive"
        },
        {
          "id": "needs-clarification",
          "label": "Needs clarification",
          "tone": "attention"
        },
        {
          "id": "kill",
          "label": "Kill",
          "tone": "critical"
        }
      ],
      "source": {
        "from": "artifact-field",
        "field": "Verdict"
      },
      "summary": true
    },
    "speckit.sdd.specify": {
      "enabled": false
    }
  },
  "clarification": {
    "enabled": true,
    "label": "Clarification needed"
  },
  "progress": {
    "enabled": true
  }
}
```

A phase has at most one result tag in schema version 1. Multiple simultaneous
result tags, such as Verdict plus Severity on one phase, are deferred to a future
schema version.

#### Result source mechanisms

The initial implementation supports exactly two bounded sources:

| Source | Use |
| --- | --- |
| `artifact-field` | Preferred source: read a configured field such as Verdict, Status, Result, or Confidence from the phase artifact |
| `phase-report` | Explicit fallback for a phase with no suitable durable artifact field: the original phase agent reports one allowed result ID during the same turn that performs the phase; no second classification turn |

Schema version 1 does not define a computed or runtime-provider result source.
Phase state, deterministic progress, and clarification remain separate protected
runtime facts rather than result-tag providers. Package `canvas-design` tags are
unrelated classification metadata.

There is no automatic source chaining. If an `artifact-field` value is missing or
invalid, the runtime produces no tag rather than falling back to `phase-report`.
Use `phase-report` only when the result contract explicitly selects it.

For a phase explicitly configured with `phase-report`, the generated runtime adds
the allowed result IDs and reporting contract to that phase's original invocation.
Phases using `artifact-field` or no result contract receive no reporting
instructions and retain the normal invocation path. The effective phase skill
performs its normal work and reports one allowed value before its original turn
completes. A missing, invalid, or stale report produces no result tag; it does not
trigger another Copilot review.

Reuse PR #32's existing generated-canvas action transport rather than registering a
new Copilot SDK tool. PR #32's separate review turn calls
`report_artifact_review` through the standard `invoke_canvas_action` tool. Generalize
that protected action to `report_phase_result` and instruct only an explicitly
configured original phase turn to invoke it:

```json
{
  "instanceId": "<current generated-canvas instance>",
  "actionName": "report_phase_result",
  "input": {
    "phaseRunId": "<ephemeral current-run id>",
    "resultId": "implemented"
  }
}
```

- The generated extension declares the `report_phase_result` canvas action alongside
  its existing actions. The phase uses the host-provided `invoke_canvas_action`
  tool; the extension does not register another agent tool or introduce a new
  transport.
- Reuse PR #32's request-binding, stale-callback rejection, idempotency, and
  persistence patterns from `report_artifact_review`, adapted from `requestId` to
  the active `phaseRunId` and from review status IDs to the configured result IDs.
- The runtime includes the current canvas `instanceId`, action name,
  `phaseRunId`, and allowed result IDs only in an invocation whose result source is
  `phase-report`.
- The runtime accepts a report only for the currently active phase run and only
  when `resultId` belongs to that run's captured result contract.
- Repeating the same report is idempotent. A conflicting second report, an unknown
  value, or a report for an older run is rejected and logged without changing the
  settled result.
- A valid report is held as pending evidence until the original phase invocation
  succeeds. If the phase fails or is cancelled, the pending report is discarded.
- Failure to report never changes a successful phase into a failed phase; it
  produces no result tag and a visible diagnostic.
- The ephemeral run ID is runtime state, not generated configuration or persisted
  authentication material.

For `artifact-field`, the corresponding workflow command must produce the
configured field and one of the configured values. Unknown or malformed values
produce no result tag and an internal diagnostic.

Progress and clarification remain separate from the result source. Task counts,
artifact currency, and clarification counts do not consume the phase's one result
tag.

#### Canvas Design customization

A preset may compose `speckit.canvas.generate` with natural-language guidance such
as:

```text
Use Implemented / Partially implemented / Not implemented as the default result
tags. For the Assess Decide phase, use Go / Needs clarification / Kill from the
Verdict artifact field.
```

The effective command normalizes that request into the supported sparse
`command-override.json` contract. It does not modify source or invent configuration
when no such guidance exists.

For exact reusable configuration, a preset or eligible design-time extension may
replace the complete named `canvas-results` template:

```yaml
provides:
  templates:
    - type: template
      name: canvas-results
      file: config/canvas-results.json
      strategy: replace
```

An explicit template replacement wins over command-derived `canvas-results`
values. If command guidance also supplied that category, the generator ignores the
suppressed sparse override and records a warning in `result.json`.

#### Presentation and notification

The configured result tag appears on the phase that produced it. Tags with
`summary: true` also appear on the workflow card and receive automatic aggregate
counts.

Use fixed semantic tones:

```text
neutral | info | positive | attention | critical
```

Initial renderer behavior is intentionally conventional:

- neutral/info/positive values render as phase badges;
- attention values render as a badge plus an inline phase message;
- critical values render as an emphasized badge plus an inline phase message;
- a changed attention/critical value is announced accessibly;
- no toast is shown for values merely discovered during initial page load.

Clarification remains a separate attention signal. A configured result value whose
label is `Needs clarification` is still an ordinary result value and is distinct
from detected unresolved `[NEEDS CLARIFICATION: ...]` markers.

#### Fixed current-state calculation model

Do not expose a general calculation-policy language in the first release. The
runtime applies one deterministic model:

1. Recalculate summaries from current workflow state rather than incrementing
   durable counters.
2. Store at most one settled result value per workflow item and phase instance.
3. A rerun replaces the prior settled result and never adds another occurrence.
4. While a rerun is pending, retain the prior settled value until the new run
   completes.
5. Exclude stale, deleted, malformed, unknown, and unavailable evidence.
6. Count distinct workflow items, not runs, artifacts, or clarification questions.
7. Include a result in summaries only when its producing phase is current and
   complete.
8. Treat unresolved clarification markers as an independent attention/blocked
   signal. The affected phase does not contribute a result to summaries until
   resolved.
9. Count clarification separately, once per workflow with one or more unresolved
   markers.
10. Calculate progress from current evidence as `completed / total`; do not treat
    it as a categorical result-tag count.
11. Reject stale reports so an older phase run cannot replace a newer settled
    value.

Canvas Design providers may customize result labels, sources, allowed values,
semantic tones, `summary`, clarification label/state, and whether deterministic
progress is shown. They may not customize deduplication, rerun replacement,
freshness, progress formulas, or arbitrary aggregation formulas.

## 4. Important Spec Kit constraint

The command frontmatter and `provides.scripts` declaration are not automatically
linked by artifact name.

This command:

```markdown
---
scripts:
  py: scripts/python/canvas_generate.py "{ARGS}"
---
```

is rewritten to the extension-local file:

```text
.specify/extensions/canvas/scripts/python/canvas_generate.py
```

It does **not** automatically execute an effective script artifact named
`canvas-generate`.

Therefore:

- `canvas_generate.py` is the stable, extension-owned entry point.
- Presets compose the command text independently.
- The generator must not assume that declaring a script in `extension.yml` changes
  the command frontmatter's physical script path.

## 5. Repository and package layout

### `github/spec-kit-copilot`

Selected repository boundary:

```text
spec-kit-extensions/
  pipeline-canvas-generator/
    extension.yml
    README.md
    commands/
      speckit.canvas.generate.md
      speckit.canvas.inspect.md
      speckit.canvas.remove.md
    scripts/
      python/
        canvas_generate.py
        canvas_inspect.py
        canvas_remove.py
      lib/
        artifact_snapshot.py
        request.py
        compiler.py
        contracts.py
        renderer.py
        receipt.py
        staging.py
        validation.py
    runtime/
      canvas-runtime-api.mjs
      generated-runtime-adapter.mjs
      renderer-host.mjs
    config/
      canvas-content.json
      canvas-theme.json
      canvas-layout.json
      canvas-interactions.json
      canvas-results.json
      canvas-onboarding.json
    renderer/
      renderer.json
      mount.mjs
      components/
        workflow-collection.mjs
        pipeline.mjs
        phase-view.mjs
        artifact-view.mjs
        clarification-view.mjs
        amendment-view.mjs
        setup-view.mjs
      styles/
        workflow-theme.css
        artifact-viewer.css
      assets/
        spec-kit-logo.webp
    templates/
      generated-canvas/
        extension.mjs
        runtime/
          setup-runtime.mjs
          approval-runtime.mjs
          amendment-runtime.mjs
          phase-results.mjs
          phase-runs.mjs
          phase-response.mjs
          project-artifacts.mjs
          workflow-adapter.mjs
          workspace-files.mjs
        ui/
          index.html
          renderer-host.mjs
    schemas/
      generation-request.schema.json
      pipeline.schema.json
      renderer-manifest.schema.json
      canvas-content.schema.json
      canvas-theme.schema.json
      canvas-layout.schema.json
      canvas-interactions.schema.json
      canvas-results.schema.json
      canvas-onboarding.schema.json
      canvas-experience.schema.json
      generation-receipt.schema.json
    tests/
      ...
```

Use `spec-kit-extensions/pipeline-canvas-generator/`. These packages are consumed
by `specify extension`, not by `copilot plugin`, and must remain separate from
`plugins/`.

The Wizard-specific preview/conformance host adapter does not belong inside the
Spec Kit extension package. It remains under the Wizard plugin and independently
implements the versioned Canvas Runtime API contract; it does not import the
generator package or its renderer. The generator's
`request.py` coordinates per-run request preparation, while
`artifact_snapshot.py` invokes the existing machine-readable Specify commands,
validates and normalizes their JSON, reads only the `tags` field from the installed
preset and extension manifests for Wizard classification, and fingerprints the
captured snapshot. These modules do not reconstruct precedence or expose raw
artifact payloads for the model to copy.

### Example `extension.yml`

```yaml
schema_version: "1.0"

extension:
  id: pipeline-canvas-generator
  name: "Canvas Generator"
  version: "0.1.0"
  description: "Generate and maintain standalone Copilot workflow canvases"
  author: "github"
  repository: "https://github.com/github/spec-kit-copilot"
  license: "MIT"
  tags:
    - canvas-design

requires:
  speckit_version: ">=<minimum-version-required-by-used-public-contracts>"

provides:
  commands:
    - name: speckit.canvas.generate
      file: commands/speckit.canvas.generate.md
      description: "Generate or regenerate a standalone workflow canvas"
    - name: speckit.canvas.inspect
      file: commands/speckit.canvas.inspect.md
      description: "Inspect the generated canvas receipt, provenance, and integrity"
    - name: speckit.canvas.remove
      file: commands/speckit.canvas.remove.md
      description: "Safely remove a recognized generated canvas"
  scripts:
    - name: canvas-generate
      file: scripts/python/canvas_generate.py
      description: "Immutable canvas generation entry point"
      runtimes: [python]
  templates:
    - name: canvas-content
      file: config/canvas-content.json
      description: "Default workflow terminology, general labels, and workflow copy"
    - name: canvas-theme
      file: config/canvas-theme.json
      description: "Default visual tokens, typography, density, and branding"
    - name: canvas-layout
      file: config/canvas-layout.json
      description: "Default navigation style, pipeline, phase, and artifact layout"
    - name: canvas-interactions
      file: config/canvas-interactions.json
      description: "Default progression, rerun, confirmation, input, and action behavior"
    - name: canvas-results
      file: config/canvas-results.json
      description: "Default phase result tags, progress, clarification, and summaries"
    - name: canvas-onboarding
      file: config/canvas-onboarding.json
      description: "Default slug, installation, approval, readiness, and setup copy"
    - name: canvas-renderer
      file: renderer/renderer.json
      description: "Default renderer for generated canvases"
```

Extension manifests do not carry the Canvas Design discovery tag. The separately
published extension catalog entry carries `tags: ["canvas-design"]`.

### Example generation command

```markdown
---
description: "Generate or regenerate a standalone Copilot workflow canvas"
argument-hint: "<canvas-id> [generation options]"
scripts:
  py: scripts/python/canvas_generate.py "{ARGS}"
---

Invoke the `skill` tool with name `create-canvas` before running any other tool
call. Use the loaded skill for canvas authoring guidance.

Read the supplied authoritative generation request. If invoked from Copilot CLI
without a request path, collect only the missing human choices, then invoke the
extension-owned Python request-preparation mode. That code refreshes Specify JSON,
validates and fingerprints composition, and writes the versioned request under the
confined generation control path. Do not transcribe artifact JSON into the request
through model output.

Treat its workflow, phase order, canvas identity, and target as authoritative. Do
not replace, reinterpret, or ask the user to reconfirm them.

Call `extensions_manage` with operation `guide`, then obtain a fresh supported
canvas scaffold for both Generate and Regenerate. For a new target, scaffold the
requested project canvas and immediately move it into the request's Spec Kit
control-directory staging area. For regeneration, scaffold under a unique temporary
project extension name and immediately move that scaffold into the same confined
staging contract without reloading it. In both cases, treat the scaffold as the
application foundation and use the common candidate builder to refine it.

Interpret the complete effective command as generation guidance. During this
command execution, write `command-override-draft.json` with one top-level
`categories` object containing only the supported configuration requested or
derived by the command. Write an empty `categories` object when there is no
derived override. Do not add a request digest.

Run `{SCRIPT} prepare-override` with the authoritative request, override-draft
path, and final command-override path. This operation validates the bounded sparse
shape, rejects protected and unknown fields, calculates `requestSha256`, and
atomically writes `command-override.json`.

Then run `{SCRIPT} generate` with the authoritative request, finalized
command-override path, and request staging path. The script resolves the
complete experience templates,
applies the override only to categories still supplied by the Canvas Generator
Extension, and performs the validated generation and refinement steps that the
supported scaffold does not provide. It may generate, copy, add, or refine declared
application files and resources, but it must operate on the verified
`create-canvas` scaffold and must never construct the application from an empty
directory or bypass the scaffold contract.

After static validation and whole-directory replacement succeed, reload extensions,
inspect the generated provider, report completion, and open the generated canvas
once for the user. Do not execute workflow phases as part of generation validation.
Report conflicts and validation failures exactly as returned by the script.
```

### Complete generation example

For every request, the extension resolves one effective artifact for each category:

```text
Authoritative generation request
  + effective workflow composition
  + command-derived experience override
  + canvas-content
  + canvas-theme
  + canvas-layout
  + canvas-interactions
  + canvas-results
  + canvas-onboarding
  + canvas-renderer
  = standalone generated canvas extension
```

With no applicable customer Canvas Design provider, all configuration and renderer
artifacts come from the Canvas Generator Extension. A preset may replace one or
more named JSON artifacts, replace the renderer, or modify the generation command.
An eligible design-time extension may replace named non-command artifacts, replace
the renderer, or supply additional explicitly invoked design commands. Categories
not replaced continue using the generator extension's defaults.

The scaffold refinement and configuration pipeline:

1. receives the confined request staging directory for both Generate and
   Regenerate;
2. reads the authoritative generation request;
3. reads effective commands, presets, extensions, providers, and priorities through
   Spec Kit JSON APIs;
4. compiles `pipeline.json`;
5. resolves and validates the six configuration artifacts;
6. combines them into deterministic application configuration;
7. resolves and validates the active renderer contract and any declared packaged
   resources;
8. preserves the supported scaffold foundation and applies validated generation,
   copying, or refinement steps needed for the product-specific runtime and
   renderer;
9. removes undeclared example or temporary paths while retaining every required
   scaffold-owned or generator-declared file;
10. validates the complete generated extension;
11. writes provenance and generated-file integrity hashes;
12. after explicit confirmation, deletes any exact existing target and moves the
    validated candidate into its place without backup or rollback.

Example output:

```text
.github/
  extensions/
    assess-workflow/
      extension.mjs
      pipeline.json
      canvas-experience.json
      .speckit-canvas.json
      README.md

      runtime/
        canvas-runtime-api.mjs
        generated-runtime-adapter.mjs
        setup-runtime.mjs
        approval-runtime.mjs
        amendment-runtime.mjs
        phase-runs.mjs
        phase-response.mjs
        project-artifacts.mjs
        workflow-adapter.mjs
        workspace-files.mjs

      ui/
        index.html
        renderer-host.mjs
        renderer/
          renderer.json
          mount.mjs
          components/
            workflow-collection.mjs
            pipeline.mjs
            phase-view.mjs
            artifact-view.mjs
            clarification-view.mjs
            amendment-view.mjs
            setup-view.mjs
          styles/
            workflow-theme.css
            artifact-viewer.css
          assets/
            logo.webp
```

Key generated files:

- `pipeline.json` is the immutable workflow, provider, artifact, setup, and runtime
  contract selected in the Wizard.
- `canvas-experience.json` is the complete validated result of template resolution
  and command-derived override application. It preserves the six category objects
  under their canonical names and is consumed directly by the generated backend
  and renderer.
- `ui/renderer/` is the complete effective renderer package.
- `.speckit-canvas.json` is the generation receipt. It records generator,
  blueprint, configuration, renderer, provenance, and generated-file integrity
  information.
- `extension.mjs` and `runtime/` are the protected standalone backend and host
  adapter.

The generated extension does not need the Wizard, Canvas Generator Extension, or
generation-only experience presets at runtime. It checks and installs only the
workflow dependencies captured in `pipeline.json`, according to the configured
launch-time installation mode.

### Example customer preset

```text
spec-kit-presets/
  copilot-canvas-brand/
    preset.yml
    config/
      canvas-theme.json
      canvas-onboarding.json
      assets/
        contoso-logo.webp
```

```yaml
schema_version: "1.0"

preset:
  id: "copilot-canvas-brand"
  name: "Copilot Canvas Brand"
  version: "0.1.0"
  description: "Applies organization-specific canvas generation policy and UX"
  author: "github"
  tags:
    - canvas-design

requires:
  speckit_version: ">=<minimum-version-required-by-used-public-contracts>"
  extensions:
    - id: pipeline-canvas-generator
      version: ">=0.1.0"
      required: true

provides:
  templates:
    - type: template
      name: canvas-theme
      file: config/canvas-theme.json
      description: "Apply organization branding"
      strategy: replace
    - type: template
      name: canvas-onboarding
      file: config/canvas-onboarding.json
      description: "Apply organization setup and approval UX"
      strategy: replace
```

This preset replaces two categories. `canvas-content`, `canvas-layout`,
`canvas-interactions`, `canvas-results`, and `canvas-renderer` continue using their
effective defaults or another higher-priority preset.

Example `canvas-theme.json`:

```json
{
  "schemaVersion": 1,
  "colors": {
    "brand": "#243A73",
    "accent": "#48C7E8",
    "surface": "#FFFFFF",
    "text": "#17213A",
    "focus": "#0067B8"
  },
  "typography": {
    "family": "segoe-system",
    "scale": "standard"
  },
  "density": "comfortable",
  "shape": {
    "radius": "medium",
    "elevation": "subtle"
  },
  "brand": {
    "logo": {
      "mode": "asset",
      "file": "assets/contoso-logo.webp",
      "alt": "Contoso"
    }
  }
}
```

Example `canvas-onboarding.json`:

```json
{
  "schemaVersion": 1,
  "workflowSlug": {
    "userProvided": true,
    "label": "Assessment ID",
    "helperText": "Choose a stable identifier for this assessment."
  },
  "installationMode": "prompt",
  "approvalCopy": {
    "title": "Prepare this workspace?",
    "message": "Review the complete workflow dependency set before continuing.",
    "communitySourceWarning": "Some components are community maintained. Continue only if you trust the listed sources.",
    "confirmLabel": "Install all and continue",
    "cancelLabel": "Not now",
    "policyText": "Installation is subject to the organization software policy."
  }
}
```

## 6. Public Spec Kit prerequisite

### Specify version compatibility gate

The generator and Wizard require a released Specify CLI version that supports the
existing public commands and manifest formats they actually use. Determine that
minimum from implementation tests of artifact, preset, extension, initialization,
and installed-manifest behavior; do not tie it to an unreleased tag or composition
feature.

The Wizard Environment page runs the ordinary `specify version` check before
reading composition JSON or enabling Generate. If the CLI is missing, malformed,
or older than that tested minimum:

- Environment remains incomplete and shows the installed and required versions;
- Generate and Regenerate remain unavailable;
- the user receives the standard Specify upgrade instruction;
- the Wizard does not read partial JSON, infer missing package classifications, or build a
  generation request.

Standalone `speckit-canvas-generate` performs the same preflight before request
preparation. It exits with an actionable upgrade error and writes no request when
the CLI is incompatible. The materializer also validates the request's recorded
CLI contract defensively, but it does not silently repair or reinterpret a request
captured by an unsupported CLI.

### Existing artifact JSON as the composition source

Use the existing Specify artifact JSON commands as the shared composition
authority:

```text
specify artifact list --json
specify preset list --json
specify extension list --json
```

`specify artifact list --json` already returns every visible artifact with its full
ordered composition stack. The Wizard therefore performs one artifact-list read,
not one list call followed by N `artifact info` calls. It joins the artifact rows
with the existing preset and extension installed-list JSON for package-level
version, priority, enabled state, and source. Because those list responses do not
currently expose tags, the Wizard reads the `tags` field from each corresponding
installed `preset.yml` or `extension.yml` and adds only that classification to its
cached model. This plan calls the normalized cached object the **artifact
snapshot**; it is not a new CLI command or new persisted Spec Kit artifact.

The normalized cached model must include:

- a Wizard cache schema version and deterministic fingerprint calculated from the
  canonical normalized JSON;
- installed and enabled preset and extension IDs, versions, priorities, and source
  metadata, plus their deterministic installed-manifest tag classification;
- every contributed artifact with kind and lookup ID;
- the complete effective-precedence stack for each artifact;
- layer strategy, active/hidden state, provider identity, version, priority,
  manifest path, and source path;
- the effective provider directory derived from the validated `sourcePath` parent so
  the generator can resolve only manifest-declared renderer files and static assets;
- the effective command's installed Copilot `SKILL.md` path, supplied directly by
  the artifact stack row's `sourcePath`.

The current artifact stack already supplies `sourceId`, `layer`, `strategy`,
`active`, `hidden`, `manifestPath`, `lookupId`, and `sourcePath`. For commands,
`sourcePath` is the concrete installed `SKILL.md`; for renderer/configuration
artifacts it is the concrete resolved file, whose parent is the bounded base for
declared adjacent assets. No separate command-binding or replace-provider-directory
field is required.

The Wizard caches the normalized result of the three JSON reads for its Composition
and pipeline UI. Package Add, Remove, Enable, Disable, Update, or priority changes
invalidate that cache. Every Generate and Regenerate performs a fresh read through
the same normalization path, updates the cache, and writes the request from the
newly captured snapshot.

The CLI owns precedence and active-layer calculation. Consumers may filter and
reshape the snapshot, but may not independently recalculate winners.

Specify validates and resolves composition according to its existing contracts.
The Wizard and generator separately validate classification policy:

- an installed package with `canvas-design` in its manifest is classified as
  design-time;
- an installed package without that tag is classified as runtime;
- catalog and installed-manifest tags must agree for a component added through
  Canvas Design;
- a Canvas Design bundle is eligible only when every included preset and extension
  is individually tagged `canvas-design`;
- a tagged component that contributes runtime phase behavior is rejected by the
  Canvas Design flow;
- these checks do not change artifact identity, precedence, or Specify mutation
  behavior.

The Wizard follows the existing catalog-read boundary:

- passive, server-side machine-readable reads use direct `specifyRun(...)`;
- user-triggered package mutations use the corresponding Copilot skills so progress
  and results remain visible in chat;
- standalone Copilot CLI generation invokes the installed generator skill, which
  uses the same Specify JSON contracts.

The existing Specify CLI JSON schemas remain authoritative. The Wizard validates
and normalizes the direct list responses into its cache without passing the
payload through the model. After preset or extension mutations complete through a
skill, the existing catalog success path invalidates and refreshes that cache.

The Wizard refresh path validates and caches one snapshot in Wizard state for:

1. the effective composition displayed by the Composition page;
2. effective pipeline derivation and command selection;
3. tag-filtered Canvas Design component state used by Generate.

When the user confirms Generate or Regenerate, request preparation refreshes that
snapshot once more, updates the same Wizard state, validates the selected phase
IDs/order against it, and writes the generation request from the refreshed object.
Materialization then uses only the captured request.

The Wizard overlays user-authored pipeline order and dialog-confirmed compact
instance settings, target, and overwrite choices; those are Wizard state, not
artifact composition. The current Wizard `composition/assembler.mjs` and
`composition/collect.mjs` remain temporary adapters only until the CLI contract is
available and are then deleted. The generator must not introduce a third resolver.

Standalone Copilot CLI generation invokes the same existing artifact, preset, and
extension list commands and normalizes them into the same request shape. This gives
the Wizard and Copilot CLI paths identical composition semantics without coupling
the generator to Wizard internals.

### Upstream Spec Kit impact

No upstream `github/spec-kit` change is required for the initial release.

The implementation consumes:

- existing artifact, preset, and extension JSON commands for composition and
  installed-package state;
- existing installed `preset.yml` and `extension.yml` files for the `tags` field
  when the list JSON omits it;
- existing installation behavior that preserves complete package manifests.

If a future Specify release exposes package tags in installed-list JSON, the
Wizard may adopt that field and stop reading manifests directly. That is an
optional simplification, not a prerequisite or release gate.

### Explicitly deferred upstream work

Do not block the MVP on:

- a general `asset` artifact kind;
- public materialization of composed script content;
- automatic ownership of arbitrary project files;
- extension install/update/remove lifecycle hooks;
- Node in script runtime metadata;
- automatic installation of preset extension dependencies.

Use Python only for the extension-owned deterministic entry points in the MVP.

## 7. Versioned contracts

All contracts are JSON, checked against bundled schemas before use.

### 7.1 Generation request

```json
{
  "schemaVersion": 1,
  "canvas": {
    "id": "assess-workflow",
    "displayName": "Assess Workflow",
    "workflowListName": "Assessments",
    "description": "Visual workflow for Intake → Research → Define → Shape → Decide."
  },
  "instanceConfiguration": {
    "workflowSlug": {
      "userProvided": false
    },
    "installationMode": "prompt"
  },
  "workflow": {
    "selectedPhases": [],
    "artifactSnapshot": {
      "schemaVersion": 1,
      "compositionFingerprint": "<digest>",
      "providers": [],
      "artifacts": [],
      "packageClassifications": [
        {
          "id": "pipeline-canvas-generator",
          "kind": "extension",
          "tags": ["canvas-design"],
          "classification": "canvas-design",
          "manifestPath": "<installed extension.yml path>"
        }
      ]
    }
  },
  "workspace": "<canonical workspace path>",
  "overwrite": false
}
```

For Wizard invocations, extension-owned request preparation refreshes the current
Specify composition, updates the Wizard's cached Composition state from that same
snapshot, and creates the request from it plus the effective Wizard pipeline and
confirmed generation choices. For Copilot CLI invocations, extension-owned Python
performs the same Specify reads and creates the same request after the skill
collects the required human choices. `canvas.id`, `canvas.displayName`,
`canvas.workflowListName`, `canvas.description`,
`instanceConfiguration.workflowSlug.userProvided`, and
`instanceConfiguration.installationMode` are exact normalized values, not
natural-language guidance. `installationMode` accepts the canonical
`external | prompt | automatic` enum, although the common Wizard checkbox exposes
only `prompt` and `automatic`. The model does not transcribe artifact stacks.

After creation, the effective generation command must preserve the snapshot,
composition fingerprint, workflow, phase order, identity, workspace, target, and
overwrite decision exactly. Regenerate may create a new request with an updated
display name, workflow heading, description, slug choice, or installation mode.
Changing the canvas ID selects a different target and is a new Generate operation,
not an in-place Regenerate edit.

### 7.2 Command-derived override and final canvas experience profile

During its execution, after reading the authoritative request, the effective
generation command writes `command-override-draft.json`. This model-authored draft
contains only the sparse `categories` object; it contains no digest or other
authoritative request fields:

```json
{
  "categories": {}
}
```

The command then invokes the extension-owned
`canvas_generate.py prepare-override` operation. That operation validates every
supplied value against the supported experience schema, reads the immutable
request directly, calculates its digest, and atomically writes the finalized
`command-override.json`. The final file binds itself to the exact request and
therefore to the command composition captured by that request. No separate command
fingerprint is calculated. An empty override is valid and is the normal result when
neither the base command nor a composing preset derives additional values:

```json
{
  "schemaVersion": 1,
  "requestSha256": "<digest>",
  "categories": {}
}
```

The model never calculates or reconstructs `requestSha256`. The `generate`
operation accepts only the finalized override, rejects a missing or malformed
final file, and rejects an override whose digest does not match the authoritative
request for the current run. It never treats the draft as a materialization input.

The generator then resolves the six complete category templates. A category
replaced by a customer Canvas Design provider is authoritative as a whole. For a
category still provided by the Canvas Generator Extension, the generator applies
any corresponding command-derived supported override and validates the result. The
merged, fully-defaulted output is `canvas-experience.json`. It preserves each
resolved category object under the same canonical category name; no second
runtime-specific configuration shape is produced. This example includes a
customer-supplied `canvas-results` override; the base generator profile does not
add result tags:

```json
{
  "schemaVersion": 1,
  "categories": {
    "canvas-content": {
      "schemaVersion": 1,
      "workflowListName": "Assessments",
      "itemName": "Assessment",
      "description": "Evaluate ideas through a structured decision workflow"
    },
    "canvas-theme": {
      "schemaVersion": 1,
      "colors": {
        "brand": "#243A73",
        "accent": "#48C7E8",
        "surface": "#FFFFFF",
        "text": "#17213A",
        "focus": "#0067B8"
      },
      "typography": {
        "family": "segoe-system",
        "scale": "standard"
      },
      "density": "comfortable",
      "shape": {
        "radius": "medium",
        "elevation": "subtle"
      },
      "brand": {
        "logo": {
          "mode": "default",
          "alt": "Spec Kit"
        }
      }
    },
    "canvas-layout": {
      "schemaVersion": 1,
      "navigation": {
        "style": "sidebar"
      },
      "pipeline": {
        "orientation": "vertical"
      },
      "phases": {
        "showDescriptions": true
      },
      "artifacts": {
        "presentation": "inline",
        "showMetadata": true
      },
      "clarification": {
        "placement": "inline"
      },
      "amendment": {
        "placement": "inline"
      }
    },
    "canvas-interactions": {
      "schemaVersion": 1,
      "progression": {
        "mode": "guided",
        "showFuturePhases": true,
        "collapseCompletedPhases": false
      },
      "rerun": {
        "enabled": true,
        "requireConfirmation": true
      },
      "inputs": {
        "retainAfterRun": true,
        "phases": {}
      },
      "phaseRunConfirmations": {},
      "artifacts": {
        "showRevisionControls": true
      }
    },
    "canvas-results": {
      "schemaVersion": 1,
      "defaultResult": {
        "label": "Result",
        "values": [
          {
            "id": "implemented",
            "label": "Implemented",
            "tone": "positive"
          },
          {
            "id": "partial",
            "label": "Partially implemented",
            "tone": "attention"
          },
          {
            "id": "not-implemented",
            "label": "Not implemented",
            "tone": "critical"
          }
        ],
        "source": {
          "from": "phase-report"
        },
        "summary": true
      },
      "phases": {
        "speckit.assess.decide": {
          "label": "Decision",
          "values": [
            {
              "id": "go",
              "label": "Go",
              "tone": "positive"
            },
            {
              "id": "needs-clarification",
              "label": "Needs clarification",
              "tone": "attention"
            },
            {
              "id": "kill",
              "label": "Kill",
              "tone": "critical"
            }
          ],
          "source": {
            "from": "artifact-field",
            "field": "Verdict"
          },
          "summary": true
        }
      },
      "clarification": {
        "enabled": true,
        "label": "Clarification needed"
      },
      "progress": {
        "enabled": true
      }
    },
    "canvas-onboarding": {
      "schemaVersion": 1,
      "workflowSlug": {
        "userProvided": true,
        "label": "Assessment ID",
        "helperText": "Choose a stable identifier for this assessment."
      },
      "installationMode": "prompt",
      "approvalCopy": {
        "title": "Install required Spec Kit components?",
        "message": "Review the complete dependency set before continuing.",
        "communitySourceWarning": "Some components are community maintained. Continue only if you trust the listed sources.",
        "confirmLabel": "Install all",
        "cancelLabel": "Cancel",
        "policyText": ""
      }
    }
  }
}
```

The schemas and merge contract must:

- provide complete defaults in the six extension-owned category templates;
- permit preset-modified generation commands to provide sparse supported overrides;
- encode the category-specific allowlisted paths and fixed scalar, array, and
  stable-ID-map merge behavior;
- prevent command-derived overrides from changing a category explicitly replaced
  by a customer Canvas Design provider;
- reject `schemaVersion`, `null` deletion, unknown fields, protected fields, and
  unsupported merge shapes in sparse overrides;
- reject unknown fields and invalid combinations;
- distinguish UX preferences from protected runtime invariants;
- record the command override, final canvas experience, providers, and normalized
  hash in the generation receipt.

### 7.3 Immutable pipeline blueprint

Retain PR #32's schema version 2 shape:

- metadata;
- linear pipeline steps;
- project-level Constitution contract;
- required skills;
- preset and extension setup records;
- runtime capabilities;
- source/provider provenance;
- artifact path templates;
- argument guidance.

Changes from PR #32:

- source data comes from the request's already-captured Specify artifact snapshot;
- records include exact resolved priority and ordered layer provenance;
- blueprint hashing is part of the generation receipt;
- Wizard-only state fields are removed.

### 7.4 Generation receipt

Store in the generated canvas directory:

```text
.github/extensions/<canvas-id>/.speckit-canvas.json
```

Minimum fields:

```json
{
  "schemaVersion": 1,
  "canvasId": "assess-workflow",
  "generator": {
    "extension": "pipeline-canvas-generator",
    "version": "0.1.0",
    "templateVersion": 33
  },
  "blueprintSha256": "<digest>",
  "configuration": {
    "sha256": "<digest>",
    "instance": {
      "displayName": "Assess Workflow",
      "workflowListName": "Assessments",
      "description": "Visual workflow for Intake → Research → Define → Shape → Decide.",
      "workflowSlug": {
        "userProvided": false
      },
      "installationMode": "prompt"
    },
    "providers": {
      "canvas-theme": {
        "id": "copilot-canvas-brand",
        "version": "0.1.0"
      },
      "canvas-interactions": {
        "id": "pipeline-canvas-generator",
        "version": "0.1.0"
      }
    }
  },
  "renderer": {
    "id": "default",
    "version": "1.0.0",
    "runtimeApiVersion": "1"
  },
  "requestSha256": "<digest>",
  "composition": {
    "command": [],
    "configuration": [],
    "renderer": []
  },
  "runtimeDependencies": {
    "presets": [],
    "extensions": []
  },
  "files": [
    {
      "path": "extension.mjs",
      "sha256": "<digest>"
    },
    {
      "path": "ui/renderer/styles/custom.css",
      "sha256": "<digest>"
    }
  ]
}
```

Keep this as a scoped technical generation receipt:

- generator and template versions support compatibility and migration;
- one normalized configuration hash supports deterministic generation and
  diagnostics without requiring per-category hash UX;
- normalized instance values make Regenerate restore the prior compact form and
  let Inspect report whether the target reflects the latest confirmed request;
- configuration provider IDs and versions identify which effective artifacts were
  materialized;
- renderer and runtime API versions support compatibility validation;
- exact runtime dependencies support generated-app readiness checks;
- generated-file hashes support integrity checks, diagnostics, and confirmation
  that the target was produced by this generator; they do not create a promise to
  preserve manual edits during regeneration.

Do not create a separate user-facing design-provenance experience. Regeneration
uses the Canvas Design components currently Added in the Wizard. It does not compare
the previous and current design provider sets, offer to reinstall prior design
components, restore old design selections, or display provider-drift warnings.

## 8. Generation algorithm

### Step 1: load and validate the authoritative request

- Resolve workspace using a canonical real path.
- Require a previously created generation-request file from either the Wizard
  adapter or the Copilot CLI command's confined request-preparation path.
- For every Generate and Regenerate invocation, require request preparation to have
  refreshed the current Specify artifact, preset, and extension JSON before writing
  the request.
- Require extension-owned code—not the model—to have validated, normalized,
  fingerprinted, and captured that composition.
- Accept a separately validated sparse command-derived experience override produced
  by the effective generation command.
- Reject attempts to alter the authoritative workflow, phase order, canvas
  identity, target, or overwrite decision.
- Validate canvas ID and derive only
  `.github/extensions/<canvas-id>/`.
- Validate display name, workflow collection heading, and description as bounded
  text; preserve normalized user wording without automatic inflection or
  paraphrasing.
- Validate `instanceConfiguration.workflowSlug.userProvided` as a strict boolean
  and `instanceConfiguration.installationMode` as the canonical enum.
- Reject symlinked workspace, `.github`, extensions directory, target, staging
  directory, or generation receipt.
- Validate all strings, booleans, labels, and size limits.

### Step 2: validate the captured artifact snapshot

- Require the request's versioned Specify artifact snapshot.
- Verify its schema version and deterministic composition fingerprint.
- Verify the captured installed-manifest tag classification.
- Verify that each selected phase command resolves to an installed Copilot skill
  binding and is not supplied solely by a package classified as Canvas Design.
- Resolve the generation command, named configuration templates, renderer manifest,
  and renderer package from the effective Specify stacks, then validate that their
  selected non-project providers are classified as Canvas Design where required.
- Use captured provider versions, priorities, stacks, active layers, source paths,
  tags, and provenance directly.
- Fail if required captured paths or bindings no longer exist; do not silently
  rebuild composition during generation.

The Wizard and standalone Copilot CLI request-preparation paths call the Specify
artifact, preset, and extension JSON APIs once for each generation run. The
materialization phase does not call them again to recreate or replace a snapshot it
already received. Request preparation and materialization may be modes of the same
Python entry point; the no-second-resolution boundary is behavioral, not a required
file split.

Do not:

- parse Rich/human output;
- read `.registry` directly;
- infer precedence independently;
- scan unregistered contribution directories;
- recalculate composition separately for the Composition page and generation.

### Step 3: compile blueprint

Port PR #32's compiler behavior:

- normalize command IDs;
- map commands to Copilot skill names;
- preserve extension command names;
- identify active provider layers;
- capture required presets/extensions and install provenance;
- derive artifact templates and persistence signals;
- model Constitution separately from item workflows;
- accept only supported linear pipelines;
- reject unsafe or unsupported artifact paths;
- calculate workflow mode and slug behavior.

Compiler output must be deterministic for identical request and Specify state.

Validate the canvas experience profile independently. Its values may change
the generated presentation and supported interaction behavior, but must not change
the compiled workflow contract.

### Step 4: preflight regeneration

If target does not exist:

- proceed with a new generation receipt.

If target exists:

- reject symlinked/reparse-point targets or paths that do not resolve to the exact
  `.github/extensions/<canvas-id>/` directory;
- inspect the generation receipt when present, but use it only to label the target
  as a recognized generated canvas and show provenance;
- show one destructive whole-target confirmation containing the exact path,
  whether the target is a recognized generated canvas or an unrecognized
  extension/folder, and an explicit statement that every file beneath it—including
  manual edits and unknown files—will be removed;
- Cancel leaves the target unchanged;
- confirmation authorizes replacement of that exact directory regardless of
  receipt validity; do not add a second adoption, drift, or force-owned-conflict
  flow.

The overwrite confirmation is intentionally general: replacement uses the Canvas
Design composition currently Added in the Wizard and discards the prior directory
as a whole. Customers who want to retain or hand-edit existing code must first copy
it to a separately owned repository location and treat that copy as an independent
canvas extension. Do not add a second prompt comparing prior and current presets,
extensions, configuration providers, or renderer choices.

### Step 5: materialize baseline in staging

- Use `.specify/.cache/canvas-generation/<request-id>/staging/` as the candidate
  location for both Generate and Regenerate.
- For every Generate and Regenerate operation, require a fresh scaffold created
  through the `create-canvas` workflow and move it into staging before refinement.
- For regeneration, use a unique temporary project extension name for scaffolding,
  move it immediately into staging without reload, and do not use the prior
  generated renderer or configuration as the desired source.
- Validate the scaffold shape before any refinement script runs.
- Build both candidates through the same scaffold-refinement pipeline from the
  current generator behavior, resolved composition, and generation brief.
- Preserve and adapt scaffold-owned SDK wiring and lifecycle structure wherever it
  satisfies the application contract.
- Allow validated scripts to generate, copy, add, or refine declared runtime,
  renderer, configuration, and asset files when the scaffold does not provide the
  required behavior.
- Remove only undeclared scaffold examples and temporary files; do not replace the
  scaffold with an independently constructed application directory.
- Resolve the active renderer contract and declared resources. With no renderer
  override, apply the generator-owned default experience through the scaffold.
- Write deterministic `pipeline.json`.
- Resolve the named experience artifacts, apply command-derived overrides only to
  extension-provided categories, then apply the allowlisted instance-request
  overlay for workflow heading, description, slug behavior, and installation mode.
- Apply the exact display name to the canvas declaration and generated metadata.
- Write one validated, deterministic `canvas-experience.json` preserving the six
  canonical category objects; do not synthesize executable UI or runtime source.

### Step 6: validate complete generated extension

Run all existing PR #32 validation, including:

- supported scaffold-contract validation and packaged-resource integrity;
- exact blueprint equality;
- canvas experience validation;
- required canvas actions;
- forbidden recursive generation/pipeline-editing actions;
- path authorization;
- setup contract;
- Constitution behavior;
- standalone startup;
- extension manifest/package shape.

Also validate:

- generated UI and runtime behavior conform to `canvas-experience.json`;
- generated canvas identity, workflow heading, description, slug behavior, and
  installation mode equal the normalized request values exactly;
- no symlinks or escaping paths;
- file count and total bytes remain under limits;
- generation receipt records cover every final generated file.

### Step 7: replace disposable output

For both Generate and Regenerate:

- do not attempt to detect whether the extension provider or one of its canvas
  instances is running; provider-loaded and canvas-open state are different, and
  the current extension tooling does not expose a reliable targeted stop operation;
- acquire a request-scoped lock for the exact canvas target before final-target
  mutation so two generation requests cannot replace it concurrently;
- validate the complete fresh candidate before changing the current target;
- for a new target, require that the exact final path remains absent;
- for any existing target, show the destructive exact-path confirmation and, after
  confirmation, delete that complete directory regardless of whether it has a
  valid generation receipt or contains partial output;
- move the validated candidate into the exact final target path;
- run final read-back validation;
- reload extensions and inspect the replacement provider.

A loaded provider is the normal regeneration case. Node has already loaded its
module source, so publication proceeds without a proactive running-state check. If
the operating system reports an actual sharing violation or locked-file error,
stop the current operation, report the failure, clean its disposable staging after
the result is consumed, and show:

```text
The generated canvas is currently using files that could not be replaced.
Stop the active Copilot session using this canvas, then select Regenerate.
```

If deletion succeeds but candidate publication, final validation, reload, or
inspection fails, make no rollback attempt and retain no backup. The target may be
absent or partial. The failure UI offers the ordinary **Regenerate** action.
Regenerate rebuilds a fresh candidate from the current authoritative composition,
shows the same exact-target confirmation for anything currently present, deletes
that target, and publishes normally. It does not reuse the prior candidate or
failed request.

Workflow artifacts and user data must live outside the disposable generated
extension directory and are never deleted by this process.

Do not add a provider quiesce protocol, automatic session shutdown, repeated
background attempts, rollback, backup, publication journal, or a distinct Retry
workflow in the initial release.

### Step 8: report

Atomically write the authoritative `result.json`:

```json
{
  "status": "succeeded",
  "target": ".github/extensions/assess-workflow",
  "designProviders": ["preset:copilot-canvas-brand@0.1.0"],
  "warnings": []
}
```

Failure results use the same versioned schema with a stable error code, conflicts
or validation details where applicable. The effective generation command and
Wizard both read this file and translate it into their user-facing status, with
Regenerate as the ordinary next action. Result consumption permits deletion of the
request-specific control directory for either success or controlled failure;
interrupted request directories are later removed by bounded cleanup.

## 9. PR #32 migration map

| PR #32 area | Destination | Change |
|---|---|---|
| `generation/compiler.mjs` | extension `scripts/lib/compiler.py` or equivalent | Port behavior; replace Wizard snapshot inputs with Specify JSON contracts |
| `generation/applicability.mjs` | extension compiler/validation | Preserve linear/Markdown constraints |
| `generation/materialize-template.mjs` | extension staging/materializer | Port to Python or invoke deterministic packaged implementation |
| `generation/storage.mjs` | extension receipt/staging | Replace Wizard request cache with a durable generated-canvas receipt and confined staging |
| `generation/naming.mjs` | extension contracts/validation | Preserve ID and confined-target rules |
| `generation/prompt.mjs` | extension base generation command | Preserve the PR #32 sequence—invoke `create-canvas`, guide, scaffold, materialize, validate, reload, inspect, report, and open—while moving configuration and lifecycle logic into the extension |
| `server/handlers-generation.mjs` | Wizard adapter | Reduce to command dispatch and progress/result presentation |
| `generated-canvas-template/extension.mjs` and runtime modules | extension protected generated backend | Move unchanged first; expose state/actions through the generated-runtime adapter |
| `generated-canvas-template/ui/app.js` | generator-owned default renderer plus generated host adapter | Decompose monolithic state/API/view code; no direct private-route or host-DOM dependencies remain in the renderer |
| `shared-workflow-ui/**` | Wizard-owned live presentation | Keep under the Wizard release lifecycle; reuse as extraction input where helpful, but do not make generated canvases or the generator package a runtime dependency |
| Wizard workflow presentation | Wizard-owned renderer and live host | Preserve the Wizard's independent UI and release lifecycle; add a separate adapter only for isolated generated-renderer preview/conformance |
| generation UI modal | Wizard plugin | Retain as optional command input UI |
| preset/extension list regex parsing | delete | Use Specify JSON output |
| `.speckit-wizard/generated-canvases/**` | delete after migration | Replaced by staging plus `.speckit-canvas.json` |

The first extraction commit should move template/runtime files with minimal edits so
Git history and parity are reviewable. Functional refactoring should follow.

## 10. Implementation sequence and pull requests

### PR A — `github/spec-kit-copilot`: extension skeleton and contracts

Deliver:

- `spec-kit-extensions/pipeline-canvas-generator/`;
- extension manifest;
- generate/inspect/remove commands;
- JSON schemas;
- category field-ownership metadata and one deterministic sparse-merge
  implementation shared by validation and materialization;
- Python request-preparation, `prepare-override`, and materialization operations in
  the stable `canvas_generate.py` entry point;
- unit tests for contract parsing and path confinement.

Acceptance:

- `specify extension add <local-path> --dev --priority 100` installs the extension
  as the low-precedence generator foundation.
- Copilot skills mode exposes `speckit-canvas-generate`.
- Every Generate and Regenerate invokes extension-owned request preparation, which
  captures current Specify JSON, validates and fingerprints it, and writes the
  request without model transcription.
- Request preparation checks the installed Specify version before any composition
  read and writes no request when it is below the tested minimum for the public
  contracts used by the generator.
- The effective command writes only the sparse categories draft.
  `canvas_generate.py prepare-override` validates it, calculates the request
  digest, and atomically writes the finalized `command-override.json`; neither the
  model nor command prose supplies the digest.
- Sparse command overrides accept only the documented category paths, replace
  arrays rather than append them, merge stable-ID maps by ID and leaf, and reject
  `schemaVersion`, `null` deletion, protected fields, and unknown fields.
- A customer category replacement suppresses the complete command-derived patch for
  that category and records a warning rather than partially merging it.
- The command invokes the `create-canvas` skill before any other generation tool,
  calls `extensions_manage guide`, and then invokes the extension-local Python
  refinement pipeline against the verified scaffold in request staging.
- Generate and Regenerate each obtain a fresh supported scaffold before the common
  candidate builder runs.
- Regeneration scaffolds under a unique temporary project extension name, moves it
  immediately into request staging without reload, and never uses the previous
  generated target as the new application foundation.
- Generate followed by Regenerate with an unchanged request produces equivalent
  application semantics, public contracts, deterministic configuration, and
  validated scaffold conformance; authored source need not be byte-identical.
- Missing `create-canvas` or scaffold tooling fails before the final target is
  modified.

### PR B — move compiler and template from PR #32

Deliver:

- pipeline compiler;
- protected template package;
- materializer;
- validators;
- baseline generation receipt;
- golden fixtures for assess, bugfix, and SDD pipelines.

Acceptance:

- Generated output matches PR #32 fixtures except intentional path and metadata
  changes. Move the existing post-phase reviewer and
  `report_artifact_review` canvas-action pathway unchanged at this stage; PR E owns
  its replacement with configured deterministic sources and original-turn
  `report_phase_result`.
- Existing PR #32 security and renderer tests are ported or continue to run.
- Identical normalized inputs produce equivalent application semantics, public
  contracts, deterministic configuration, and a valid generation receipt; authored
  scaffold source need not be byte-identical.

### PR C — optional preset modification fixture

Deliver:

- a development/test preset wrapping `speckit.canvas.generate`;
- an added precondition, generation-procedure instruction, and post-generation
  validation step;
- tests for prepend, append, wrap, and replace command strategies.

Acceptance:

- With no preset installed, the installed skill matches the extension's base
  command.
- With the fixture preset installed, the installed skill contains the expected
  effective command.
- The supplied generation request remains byte-for-byte unchanged.
- Prepend, append, and wrap fixtures still invoke the `create-canvas` workflow and
  immutable materializer.
- A replace fixture may omit the complete base workflow and is treated as
  customer-owned generation. The Wizard does not report it as validated
  generator-owned output unless it independently returns the required callback,
  generation receipt, and validation evidence.

### PR D — experience configuration and phase result tags

Deliver:

- named JSON configuration resolution for `canvas-content`, `canvas-theme`,
  `canvas-layout`, `canvas-interactions`, `canvas-results`, and
  `canvas-onboarding`;
- one canonical schema path and category owner for every supported setting, with no
  legacy aliases or duplicate cross-category ownership;
- no-op presentation selectors omitted from schema version 1 until the default
  renderer supports and tests multiple behaviors;
- confirmation-only `phaseRunConfirmations` in `canvas-interactions`, keyed by
  stable phase ID and rendered before skill dispatch;
- `external`, `prompt`, and `automatic` launch-time installation modes;
- non-installing prerequisite checks for the compatible `spec-kit-copilot` plugin,
  `specify` CLI, Copilot-skills-mode project initialization, and reload capability;
- read-only initialization detection through `.specify/init-options.json`, expected
  infrastructure, and generated Copilot skill layout;
- an explicitly confirmed **Initialize Spec Kit** remediation action using
  `specify init --here --force --integration copilot
  --integration-options="--skills" --script py --ignore-agent-tools`;
- protected all-or-nothing dependency review with customizable bounded approval
  copy;
- phase-state presentation separated from one optional phase result tag, progress,
  and clarification;
- explicit result configuration only, with no automatic label inference from skill
  prose;
- one global default result contract with optional per-phase replacement or disable;
- `artifact-field` and `phase-report` result sources;
- replacement of PR #32's `report_artifact_review` action with the generalized
  `report_phase_result` canvas action, reusing the existing
  `invoke_canvas_action` transport and validation/persistence approach;
- original-turn phase reporting only for phases explicitly configured with
  `phase-report`, with no separate post-phase Copilot reviewer or newly registered
  SDK tool;
- direct phase presentation, workflow summaries, and automatic counts;
- fixed current-state summary calculation with rerun replacement, freshness,
  clarification eligibility, and distinct-workflow counting;
- explicit preset fixture replacing `canvas-results`.

Acceptance:

- With no explicit result configuration, phases display no result tag.
- A global default label set applies to all enabled phases, preserving PR #32's
  configured-label behavior without a second review turn.
- Assess explicitly configures Decision only on the Decide phase.
- A phase-specific result contract replaces or disables the global default for that
  phase.
- SDD may use execution state/staleness and task progress without result tags.
- A custom preset can add a finite result such as Confidence when its phase command
  reports the configured value or produces the configured artifact field.
- Attention and critical values notify directly on the producing phase.
- Rerunning a phase never double-counts a workflow and replaces its prior settled
  result value.
- Stale downstream results and phases with unresolved clarification markers do not
  contribute to summaries.
- Clarification counts workflows, not individual questions, while an explicit
  `Needs clarification` result value remains distinct from marker detection.
- The aggregation engine remains protected and versioned; presets do not provide
  arbitrary formulas or executable counting logic.
- A Canvas Design preset can add a branded confirmation before a phase skill is
  invoked; Cancel does not dispatch the skill and Confirm dispatches the captured
  effective phase command. Only a phase explicitly configured with
  `phase-report` receives the additional canvas-action reporting contract.
- `external` mode never installs and remains blocked until the customer's setup
  workflow provides the complete runtime dependency set.
- `prompt` mode shows the complete set and installs all or none.
- `automatic` mode installs the exact fingerprint-bound runtime dependency set
  without destination-user approval because the generating administrator selected
  that policy.
- The generated canvas never installs the `spec-kit-copilot` plugin or `specify`
  CLI. It may initialize the current project only through the protected
  destination-user-confirmed action; cancellation or failure remains blocked with
  actionable remediation.
- `external`, `prompt`, and `automatic` runtime-package modes cannot silently run
  `specify init` or bypass its warning.
- Community dependencies in `prompt` mode require the protected warning.
  Community dependencies in `automatic` mode require generation-time disclosure
  and administrator authorization, and still cannot bypass host permissions or
  source-provenance verification.
- Generation-only experience presets are not reinstalled at canvas launch.
- No separate runtime LLM result review is dispatched.
- Invalid result IDs, values, fields, command selectors, sources, and tones fail
  schema validation.

### PR E — pluggable generated-renderer contract

Deliver:

- one documented `CanvasRuntimeApiV1` with a normalized snapshot and action-result
  shape;
- generated-runtime and isolated Wizard preview/conformance adapters implementing
  the same API;
- extraction of PR #32's generated `ui/app.js` into a generator-owned default
  renderer package, reusing presentation code as an initial migration aid without
  creating a cross-package runtime dependency;
- `mountCanvas` entrypoint contract and renderer manifest schema;
- standard experience configuration passed unchanged to every renderer;
- renderer package resolution, validation, provenance, and static publication;
- one API contract suite for both host adapters;
- renderer conformance harness using a mock conforming API;
- sample replacement renderer that reuses standard configuration and adds one
  custom dashboard element.

Acceptance:

- The Wizard's live workflow UI does not load renderer files from the installed
  generator extension.
- Removing, disabling, repairing, or updating the generator changes generation
  readiness only and does not break or restyle the Wizard's live workflow UI.
- The generator's default renderer works through the generated-runtime adapter and
  through the isolated Wizard preview/conformance adapter.
- The renderer imports only the documented API and does not depend on host DOM IDs,
  private HTTP routes, backend persistence, or source-tree-relative Wizard modules.
- A replacement renderer can consume existing Canvas Design provider configuration
  or all extension defaults without changing those providers.
- A replacement renderer can add new presentation elements using standard runtime
  state without adding backend actions, filesystem access, or security
  capabilities.
- Required dependency facts, community warnings, and all-or-nothing approval
  semantics remain visible in every conforming renderer.
- Desktop, mobile, keyboard, accessible-name, and light/dark checks pass for the
  generator's default renderer in generated output and the isolated preview.
- A generator-renderer change that violates the API contract or regresses generated
  output fails without imposing visual parity on the Wizard's live renderer.
- Third-party renderers are tested against the mock API rather than an exhaustive
  host-by-renderer cross-product.

### PR F — regeneration and lifecycle

Deliver:

- disposable-output validation and overwrite confirmation;
- complete candidate materialization before target replacement;
- request-scoped target lock and destructive whole-directory replacement without
  backup;
- ordinary Regenerate handling for any complete, partial, receipt-less, or failed
  target;
- explicit remove command.

Acceptance:

- Clean regeneration succeeds.
- The overwrite confirmation shows the exact target path, distinguishes recognized
  generated output from an unrecognized extension/folder, and clearly states that
  every file beneath it will be replaced.
- After confirmation, manual edits and unknown files are replaced rather than
  merged or preserved, regardless of receipt validity.
- Cancel leaves either a recognized or unrecognized target unchanged.
- Candidate validation failure leaves the current target unchanged.
- No prior-directory backup, rollback attempt, publication journal, or distinct
  Retry state is created.
- An interrupted or locked replacement reports failure and offers Regenerate.
  Regenerate rebuilds from the beginning and applies the same confirmation,
  deletion, and publication behavior to any resulting target state.
- Regeneration rebuilds from the currently captured Canvas Design and runtime
  composition, not from the previous generated renderer/configuration.
- Remove deletes a complete recognized generator target after confirmation.
  Regenerate handles receipt-less or partial output. Neither path follows symlinks
  or deletes workflow artifacts/user data outside the exact confirmed directory.

### PR G — Wizard adapter

Deliver:

- replace the temporary Wizard composition manifest scanner/assembler with the
  versioned cached artifact snapshot derived from the existing CLI's artifact,
  preset, and extension list JSON through the Wizard's established direct
  `specifyRun(...)` path;
- invalidate and rebuild that cache through the existing preset/extension catalog
  success path after user-triggered skill mutations;
- store one validated snapshot in Wizard state and use it for the Composition page,
  effective pipeline derivation, and generation request;
- read installed preset and extension manifest tags for package classification
  when Specify's installed-list JSON omits them;
- centralize tag-based filtering so the Main Catalog and Phases tab omit
  `canvas-design` packages while the Generate experience includes them;
- preserve Wizard-owned user pipeline order and confirmed generation fields as an
  overlay rather than moving them into Specify composition;
- retain PR #32's compact Generate form for Target, Extension ID, Name, Workflow
  header, Description, Allow custom slug, and Require installation approval,
  preserving its field order, label/help/control structure, accessibility
  associations, debounced preflight, and overwrite confirmation;
- remove the Phase result tags editor from the common Generate form; result and
  clarification semantics come from generator defaults and Canvas Design
  composition;
- map the slug checkbox to
  `instanceConfiguration.workflowSlug.userProvided` and the installation checkbox
  to canonical `prompt` or `automatic` mode;
- on Regenerate, restore the compact fields from the prior generation receipt,
  keep Extension ID and Target bound to the existing canvas, and allow edits to
  Name, Workflow header, Description, slug behavior, and installation approval;
- generation modal dispatches `speckit-canvas-generate`;
- Canvas Generator Extension installation and readiness in the Wizard Environment
  page alongside default preset/extension setup;
- Specify CLI minimum-version readiness in the same Environment flow, checked
  before composition reads or Generate enablement;
- repair of an installed generator that is disabled or not at required priority
  `100` without reinstalling it;
- Canvas Design area in the Generate dialog using the existing Catalog cards,
  search, source/trust presentation, and community confirmation;
- Presets, Extensions, and Bundles tabs filtered by catalog-level
  `canvas-design`;
- Generate-button readiness gating that directs missing/failed generator setup to
  the Environment page rather than installing while opening the dialog;
- immediate one-component Add and Remove behavior matching the current Wizard
  Catalog: Add installs; Remove uninstalls; no deferred or mixed batch;
- reuse of the current preset/extension installed-ID reload path and bundle explicit
  reload path, with no deferred Generate-time reload;
- support for design-time extensions that add explicitly invoked commands;
- progress/result integration;
- removal of duplicate compiler/materializer/storage code;
- updated Wizard documentation and tests.

Acceptance:

- Generate and Regenerate refresh the current Specify composition, update the
  Wizard's cached Composition state, and write the request from that same snapshot
  and fingerprint.
- The normal Wizard refresh path uses direct machine-readable CLI reads, matching
  the existing preset/extension catalog hydration pattern.
- No assistant prose, skill summary, or reconstructed object participates in
  Wizard composition state.
- Canvas Design commands do not appear in the Phases tab or Main Catalog; the
  Composition page either omits or labels their providers according to its
  runtime-focused UX without changing Specify's effective stacks.
- The generator command and explicitly invoked Canvas Design support commands
  remain available to Copilot after skill reload.
- Request preparation resolves composition exactly once for the run; materialization
  does not query Specify again or substitute later package state.
- The temporary Wizard manifest scanner and precedence assembler are removed.
- Given identical `request.json` and `command-override.json`, Wizard- and
  Copilot-CLI-generated canvases satisfy the same application, configuration,
  scaffold, and validation contracts; authored source need not be byte-identical.
- Wizard form input and equivalent standalone natural-language input normalize to
  identical instance-request fields.
- The Canvas Generator Extension appears first as Added and Required, cannot be
  removed in the Generate dialog, and is installed through the Environment page.
- The Generate dialog opens immediately only when Environment readiness confirms
  both the generator and a Specify CLI at or above the tested minimum required by
  the public contracts used by the Wizard; a missing, malformed, or older CLI
  routes to the Environment remediation experience and no composition JSON is read.
- Community Canvas Design components use the same confirmation interaction as the
  existing Catalog before Add installs them.
- Remove uninstalls one design component immediately and refreshes composition; it
  does not defer the change until Generate.
- Generate performs no package-management batch and uses the current enabled
  Canvas Design composition.
- Generated canvas remains standalone after transfer to a clean repository.

### PR H — catalog, bundle, and release

Deliver:

- Canvas Generator Extension catalog entry tagged `canvas-design`;
- Canvas Design catalog entries and authoring guidance for design-time presets,
  extensions, and design-only bundles;
- Wizard validation that requires catalog-tagged installed components to retain
  `canvas-design` in their installed package manifests;
- generated-app Catalog filtering that excludes `canvas-design` entries;
- optional design-only bundle containing compatible Wizard generation components;
- catalog and installed-manifest validation that excludes untagged components and
  packages contributing runtime phase behavior from Canvas Design eligibility;
- sample customer preset;
- sample customer extension with a distinct explicitly invoked design command and
  optional named template contribution;
- versioning and release notes;
- installation documentation.

Acceptance:

- Fresh repository install from catalog works.
- The Generate dialog uses the Wizard's existing catalog loader and fixed
  plugin-owned source set and shows tagged entries under the correct Presets,
  Extensions, and Bundles tabs.
- The generated app excludes `canvas-design` entries from catalog tabs, search,
  counts, recommendations, updates, and installation actions.
- Community design-time installation honors the existing Wizard Catalog trust and
  confirmation behavior.
- Updating the generator preserves compatible generated canvases and reports
  migration requirements.

## 11. Test matrix

### Composition

- Generate and Regenerate refresh the current composition, update the Wizard
  Composition cache, and write the request from the same versioned artifact
  snapshot and fingerprint.
- The normal Wizard refresh path uses direct `specifyRun(...)` artifact, preset,
  and extension list JSON and does not route composition through an agent turn.
- Failed, malformed, or incomplete CLI reads do not replace the prior validated
  cache.
- The snapshot contains one Specify-resolved composition model plus deterministic
  package tags read from installed manifests.
- The Phases tab and Main Catalog omit packages classified as Canvas Design.
- Canvas Design providers and commands are absent from those runtime surfaces even
  though their skills remain available for explicit generation orchestration.
- The Composition page's filtering or labeling does not recalculate or change
  Specify artifact precedence.
- Catalog and installed-manifest tags are compared for Canvas Design additions.
- Local and development installs are classified from their installed manifests
  without requiring catalog metadata or an upstream JSON field.
- Untagged packages are treated as runtime in Wizard surfaces.
- A tagged package that contributes a selected runtime phase command is rejected
  by Wizard/generator validation without changing Specify registry behavior.
- Standalone Copilot CLI generation normalizes the same Specify artifact snapshot
  contract into an equivalent request.
- Adding, removing, enabling, disabling, updating, or reprioritizing providers
  between runs appears in the next Generate or Regenerate request.
- Changing the selected phases or their order between runs appears in the next
  request.
- A composition change after request capture does not alter the in-flight
  materialization; it appears on the next run.
- The Copilot CLI model supplies human choices but never transcribes provider
  stacks, paths, priorities, or fingerprints.
- The model-authored override draft contains only `categories`; extension-owned
  code validates it and adds the exact request digest when atomically writing the
  finalized override.
- Materialization rejects a missing finalized override, a digest mismatch, and any
  attempt to pass the model-authored draft directly as the override.
- Failed request preparation leaves the previous validated Wizard cache intact and
  does not start materialization.
- No Wizard or generator code independently recomputes artifact precedence.
- No presets.
- Command-only preset.
- One preset wrapping both.
- Multiple wrapping presets at different priorities.
- Equal-priority presets.
- Disabled preset.
- Required extension missing.
- Trusted, organization-private, community, and untrusted catalog sources.
- Missing, incompatible, and valid `spec-kit-copilot` plugin.
- Missing, incompatible, and valid `specify` CLI.
- Uninitialized folder, non-Copilot initialization, and valid Copilot-skills-mode
  initialization.
- Missing, malformed, and incompatible `.specify/init-options.json`.
- Initialization is not inferred from `.specify/` alone, `.github/skills/` alone,
  or `specify check` alone.
- Initialize Spec Kit confirmation accepted and cancelled.
- The accepted action runs the exact non-interactive Copilot skills-mode command
  with `--here`, `--force`, `--script py`, and `--ignore-agent-tools`, then reloads
  skills and reruns readiness.
- Initialization failure remains blocked and surfaces the CLI error.
- `automatic` runtime-package mode does not bypass initialization confirmation.
- Launch setup in `external`, `prompt`, and `automatic` modes.
- Prompt approval accepted and cancelled.
- Prompt approval covers the complete dependency set; partial installation is not
  offered.
- Changed dependency version, source, priority, or membership invalidates prior
  approval.
- Automatic mode installs the exact administrator-authorized dependency set without
  a generated-app approval prompt.
- Automatic mode with a community dependency whose identity and source match the
  generated blueprint.
- Automatic mode blocks source drift, unavailable credentials, and host-permission
  denial without substituting another provider.
- External mode reports missing dependencies without exposing an install action.
- External mode recognizes a folder fully prepared by a separate setup process and
  performs no installation.
- Custom approval title, message, warning, labels, and policy text.
- Invalid or missing community-source warning.
- Generation-only presets omitted from launch-time installation.
- A Canvas Design preset that only composes `speckit.canvas.generate` affects the
  normalized generation override and is omitted from generated-app runtime
  dependencies.
- Canvas Design preset added, removed, and added again through the Generate
  dialog.
- A Canvas Design extension command is available for explicit generation
  orchestration after Add and skill reload but is absent from the Phases tab,
  runtime command picker, and Main Catalog; the Composition page may omit or label
  it without changing the effective artifact stack.
- A Canvas Design extension can replace a named non-command experience template or
  renderer through normal extension-tier precedence.
- Installing a Canvas Design extension does not automatically execute all of its
  commands; only the effective generator command or an explicit Generate action
  invokes a contributed design command.
- Successful Canvas Design preset/extension Add or Remove automatically reloads
  current-session skills through the existing installed-ID change path; successful
  bundle operations use the existing explicit bundle reload path.
- Generate and Regenerate do not perform a delayed package-management skill reload.
- Removed Canvas Design presets and extensions no longer participate in generation.
- Main Catalog runtime composition remains independent from the Generate dialog's
  Canvas Design component management.
- Generation invokes `speckit.canvas.generate` but does not invoke selected phase
  skills; it only inspects their effective definitions and captures their runtime
  providers.
- A phase skill and its runtime preset composition execute only after the user runs
  that phase in the generated application.

### Canvas Design catalog

- Only catalog entries tagged `canvas-design` appear.
- Installed entries must also carry `canvas-design` in their installed
  `preset.yml` or `extension.yml`.
- Presets, extensions, and bundles appear under the correct tabs.
- The existing Wizard Catalog loader, fixed plugin-owned source set, and priority
  order are used; arbitrary user-configured Spec Kit catalogs are not discovered.
- Canvas Generator Extension appears first as Added and Required with no Remove
  action.
- The Environment page installs the missing Canvas Generator Extension with the
  Wizard's default presets/extensions at priority `100`, reloads skills, and
  reports readiness.
- A missing or older Specify CLI keeps Environment incomplete, shows installed and
  required versions plus the standard upgrade instruction, and prevents all
  composition reads and generation requests.
- When installed-list JSON omits tags, the Wizard reads only the `tags` field from
  the installed package manifest and treats an absent `canvas-design` tag as
  runtime classification.
- An already installed generator at the wrong priority is changed to `100`, and a
  disabled generator is enabled, without reinstalling it.
- Generate does not install the generator while opening the dialog; missing or
  failed readiness sends the user to Environment setup/retry.
- Trusted Add installs exactly one component immediately.
- Community Add shows the existing confirmation before installation.
- Cancelled community confirmation leaves the component unadded.
- Remove uninstalls exactly one component immediately.
- Failed Add remains Add and reports the failure.
- Failed Remove remains Added and reports the failure.
- Generate is disabled while an Add or Remove operation is active.
- Cancel closes the dialog without generation but does not roll back completed
  Add or Remove operations.
- Generate performs no install/remove batch.
- Canvas Design bundles contain design-time components only in the initial
  release.
- Individual Canvas Design presets and extensions are also design-time-only in the
  initial release.
- A bundle is not eligible for the Canvas Design bundle tab or Add flow when any
  included preset or extension lacks its own `canvas-design` tag.
- A tagged preset or extension that contributes runtime phase behavior is rejected
  from the Canvas Design Add flow.
- Generated-app catalog results exclude all `canvas-design` entries before search,
  sorting, pagination, counts, recommendations, or update presentation.

### Generation

- `create-canvas` skill is invoked before every other generation tool call.
- `extensions_manage guide` precedes scaffold creation.
- The complete same-turn construction brief includes the exact normalized display
  name, workflow header, description, slug choice, and installation mode before
  `create-canvas` is invoked.
- `create-canvas` uses those values to shape the scaffold, while deterministic
  refinement and validation use `request.json` as final authority.
- Generate and Regenerate each create a fresh supported scaffold and move it into
  request staging before invoking the common candidate builder.
- Regeneration uses a unique temporary project extension name and moves the
  scaffold without reloading it.
- Generate and Regenerate with identical captured inputs produce equivalent
  application semantics, deterministic configuration, public contracts, and
  scaffold conformance; authored source need not be byte-identical.
- Removing one Canvas Design provider and adding another before Regenerate produces
  a complete replacement containing only the newly resolved composition.
- Missing skill/scaffold capability fails before final-target mutation.
- Static validation succeeds before extension reload, provider inspection, and
  opening the generated canvas.
- Generation opens the canvas once for handoff but does not execute any workflow
  phase.
- Assess pipeline.
- Bugfix pipeline.
- Core SDD pipeline.
- Constitution-only project workflow.
- Extension-provided command.
- Preset-overridden command.
- Duplicate command instances.
- Unsupported branching pipeline.
- Non-Markdown artifact.
- Unsafe artifact path.
- PR #32 compact form preserves exact field order, labels, descriptions, control
  types, and accessible label/description associations.
- Target is read-only and derived from Extension ID.
- Workflow header preserves capitalization and wording without inflection.
- Description is present, editable, persisted in the request/receipt, and rendered
  in the generated canvas.
- Allow custom slug maps to the canonical strict boolean.
- Require installation approval maps to `prompt` when checked and `automatic`
  when unchecked, with exact dependency-set authorization still enforced.
- No per-phase settings, general-guidance field, or Phase result tags editor
  appears in the common form.
- Wizard form input and equivalent standalone chat input produce identical
  normalized request values.
- Regenerate restores the prior compact values; changing Extension ID requires a
  new Generate target.
- Canonical SDD fixture uses Name `Spec-Driven Development`, Workflow header
  `Features`, an SDD description, automatic slug selection, and prompt-mode
  installation approval.

### Canvas experience configuration

- Every supported setting appears at exactly one canonical category path.
- The request-level instance overlay may set only display name,
  `canvas-content.workflowListName`, `canvas-content.description`,
  `canvas-onboarding.workflowSlug.userProvided`, and
  `canvas-onboarding.installationMode`.
- The instance overlay is applied after template and command-derived resolution,
  then affected categories and the final profile are revalidated.
- The instance overlay cannot set phase-specific content, results, theme, layout,
  renderer, assets, commands, artifact paths, dependency identity, provenance,
  permissions, or security disclosures.
- Legacy/duplicate aliases such as `userProvidesSlug`,
  `identity.userProvidesSlug`, `setup.installationMode`,
  `navigation.mode`, `retainInput`, `allowRerun`, and
  `pipelineOrientation` are rejected rather than silently normalized.
- `canvas-layout` controls visual structure and placement; it does not control
  guided/free progression, rerun behavior, input retention, or action visibility.
- `canvas-interactions` controls behavior and action visibility; it does not
  control navigation visual style, pipeline orientation, or artifact placement.
- `canvas-content` general copy cannot replace phase-input guidance or
  setup/readiness/install copy.
- `canvas-onboarding` setup copy cannot replace general workflow copy.
- Theme colors, typography, density, shape/elevation, and branding each change
  renderer output.
- Navigation style, pipeline orientation, phase descriptions, artifact
  presentation/metadata, and clarification/amendment placement each change
  renderer output.
- Guided/free progression, future-phase visibility, completed-phase collapse,
  rerun enablement/confirmation, input retention/guidance, phase confirmations, and
  revision-control visibility each change runtime or renderer behavior.
- Schema version 1 rejects generic `theme`, `colorMode`, `responsive`,
  `setupPresentation`, `phaseStatePresentation`, `openTo`, and unspecified
  progress-presentation fields.
- The renderer remains responsive and host-theme-aware without configuration
  switches for those fixed behaviors.

### Phase result tags

- No explicit configuration produces no result tag.
- Global default result with two, three, and more allowed values.
- Per-phase replacement of the global result contract.
- Per-phase disable while a global default exists.
- Schema version 1 rejects multiple simultaneous result tags for one phase.
- `artifact-field` extraction with matching, missing, unknown, and malformed values.
- Missing or invalid `artifact-field` evidence produces no tag and never falls
  through to `phase-report`.
- Original-turn `phase-report` invokes the generated canvas's
  `report_phase_result` action through the standard `invoke_canvas_action` tool,
  with valid, invalid, stale, conflicting, repeated, and missing callbacks.
- Phases not explicitly configured with `phase-report` receive no reporting
  instruction or run ID.
- No separate post-phase Copilot classification request.
- No custom result-reporting SDK tool is registered.
- Schema version 1 rejects a computed or `runtime` result source.
- Runtime task progress.
- Repeated phase reruns replace the settled result value without increasing the
  workflow count.
- A pending rerun retains the prior settled value until completion.
- An upstream rerun makes dependent downstream result values stale and removes
  them from summaries until refreshed.
- Deleting result evidence removes it from summaries.
- Multiple unresolved clarification markers count as one affected workflow.
- An unresolved clarification suppresses summaries from its affected phase without
  erasing the successful phase dispatch.
- Explicit `Decision = Needs clarification` remains a valid result value and is
  distinct from an unresolved clarification marker.
- Generation does not infer labels from Assess, Bugfix, SDD, or custom skill prose.
- Natural-language generation-command guidance produces a validated sparse
  `canvas-results` override only when explicitly requested.
- An empty override draft finalizes to a valid request-bound override with an empty
  `categories` object.
- Override finalization rejects protected fields, unknown fields, malformed
  categories, and drafts containing model-supplied digest or schema authority.
- Override finalization writes atomically and does not leave a success-shaped
  partial `command-override.json` when validation or writing fails.
- Explicit `canvas-results` replacement wins over command-derived values and emits
  a suppression warning.
- Sparse scalar replacement, complete-array replacement, and stable-ID-map
  leaf merging for every command-overridable category.
- Sparse override rejects `schemaVersion`, `null` deletion, unknown paths,
  protected fields, arbitrary HTML/code, custom unsupplied asset paths, and
  unsupported merge shapes.
- A complete customer category replacement suppresses that category's entire sparse
  command patch; no field-level mixing occurs.
- Attention and critical values displayed directly on the producing phase.
- Summary result tags rolled up to workflow cards and aggregate counts.
- Result added by a preset whose phase command was also modified to emit the
  required field.

### Renderer contract and product independence

- Generator default renderer mounted through the generated-runtime adapter.
- Generator default renderer mounted through the Wizard's isolated
  preview/conformance adapter.
- Wizard live renderer remains available when the generator is absent, disabled,
  broken, or being updated.
- Contract fixtures produce valid equivalent state/action semantics through both
  generated-renderer adapters; visual equality with the Wizard's live renderer is
  not required.
- Default standard configuration only.
- Preset-replaced standard configuration with the default renderer.
- Replacement renderer using default standard configuration.
- Replacement renderer using preset-replaced standard configuration.
- Renderer adds a custom dashboard element derived from standard state.
- Default bundled Spec Kit logo.
- Preset-packaged custom PNG, JPEG, and WebP logos.
- `brand.logo.mode: none` removes the logo without leaving empty layout space.
- Missing logo asset, path escape, symlink, oversized dimensions/bytes, unsupported
  format, and empty alt text.
- Generated canvas loads its vendored logo without a runtime network request.
- Renderer attempts to call an undeclared action.
- Renderer depends on a private HTTP route or host DOM ID.
- Renderer omits required setup dependency facts.
- Renderer hides the required community-source warning.
- Renderer offers partial dependency selection.
- Renderer capability does not match the host capability.
- Unsupported Canvas Runtime API version.
- Undeclared renderer file, escaping path, symlink, or oversized package.
- Desktop/mobile, keyboard, accessible-name, light/dark, and visual regression
  coverage for the generator renderer, plus the Wizard's separate live-renderer
  release suite.
- Both host adapters pass the same Canvas Runtime API contract suite.
- Every renderer passes the mock-API conformance suite.
- Generator default renderer runs end-to-end in generated output and isolated
  Wizard preview.
- One replacement renderer runs end-to-end as proof without requiring a full
  host-by-renderer cross-product.

### Regeneration

- No prior target.
- Existing generated canvas shows the PR #32-style overwrite confirmation.
- Regenerate restores Name, Workflow header, Description, slug behavior, and
  installation approval from the prior receipt.
- Regenerate permits changes to those presentation/onboarding values but keeps
  Extension ID and Target fixed.
- Cancel at the overwrite confirmation leaves the target unchanged.
- Unrecognized extension/folder shows a stronger whole-directory deletion warning
  with the exact path; confirmation permits replacement and Cancel preserves it.
- Regenerate uses the currently Added Canvas Design composition without a
  previous-versus-current provider warning.
- Generator-owned target with and without manual edits or unknown files.
- Manual edits and unknown files are removed after explicit whole-target overwrite
  confirmation.
- Symlinked or escaping target is rejected.
- Changed preset order.
- Preset removed.
- Generator/template version upgrade.
- Locked target during confirmed deletion or publication.
- Interrupted target deletion, candidate publication, reload, and inspection.
- Each failure offers ordinary Regenerate; Regenerate rebuilds a fresh candidate,
  confirms deletion of any exact partial target, and publishes without using prior
  staging or backup state.

### Platforms and integrations

- Windows.
- macOS/Linux.
- Copilot skills-mode initialization.
- Copilot CLI invocation with no Wizard installed or running.
- Copilot CLI invocation after installing Canvas Design presets, extensions, and
  bundles through Specify and reloading skills.
- Copilot CLI invocation produces the same authoritative request schema as the
  Wizard and identical output for equivalent confirmed inputs.
- Bare `specify` execution without the Copilot canvas-authoring host fails with a
  clear unsupported-entry-point message rather than partially generating files.
- Wizard invocation.
- Transfer generated extension to a fresh repository.
- Current-session skill reload.

## 12. Security and trust model

- Renderer JavaScript and design-time extension commands are executable code even
  when packaged beside a template. They inherit the same catalog trust and
  community-confirmation decision made when the Canvas Design component is added;
  schema and conformance validation do not convert untrusted code into trusted
  code.
- Generation must never grant broader permissions than the host already grants.
- Do not pass credentials, auth tokens, callback URLs, or unrestricted workspace
  paths.
- The generated runtime retains PR #32's loopback host/origin/token checks.
- Community sources must retain HTTPS and install-allowed catalog requirements.
- The generating administrator's `automatic` policy authorizes only the complete,
  captured dependency-set fingerprint; membership, version, source, priority, or
  enabled-state drift blocks installation until the canvas is regenerated.
- `automatic` setup does not bypass Copilot host permissions, organization policy,
  source authentication, or exact provenance checks.
- The generated canvas does not install the `spec-kit-copilot` plugin or
  `specify` CLI. It may initialize the destination project only after the user
  accepts the explicit warning for the protected Copilot skills-mode
  `specify init --here --force` action.
- Destination-user approval in `prompt` mode is bound to the complete dependency-set
  fingerprint and becomes invalid when membership, version, source, priority, or
  enabled state changes.
- Custom approval copy cannot hide protected component facts or weaken the
  all-or-nothing decision.

## 13. Documentation deliverables

- Extension README:
  install, Wizard usage, standalone Copilot CLI usage, package prerequisites,
  skill reload, command usage, supported pipelines, regeneration, and removal.
- Canvas Design author guide:
  catalog-level `canvas-design` tagging, design-time versus runtime package
  boundaries, preset-first customization, extension-provided templates/renderers,
  immediate Add/Remove behavior, design-only bundles, and explicit invocation of
  design extension commands.
- Preset author guide:
  command strategies, named configuration templates, renderer replacement, asset
  packaging, and security.
- Extension author guide:
  distinct command naming, explicit invocation, named non-command template and
  renderer contributions, precedence, asset packaging, and security.
- Contract reference:
  all JSON schemas and compatibility policy.
- Migration note:
  PR #32 Wizard generation to extension-owned generation.
- Troubleshooting:
  Python availability, artifact snapshot failure, renderer validation, drift
  conflicts, missing extension dependencies, and skill reload.

## 14. Required implementation validation before release

These are not product-policy choices, but the implementation cannot be considered
complete until they are proven:

1. **Minimum supported Specify version:** replace manifest placeholders with the
   earliest released CLI version verified to support the existing artifact, preset,
   extension, installation, and initialization contracts used by the implementation.
   Tag classification may read installed manifests directly and therefore does not
   require a new installed-list JSON field. Use the tested minimum consistently in
   extension manifests, the Wizard Environment gate, standalone request preparation,
   generated request compatibility metadata, tests, and documentation.

## 15. Wizard and generation-command boundary

Specify's versioned artifact snapshot is authoritative for installed composition:

- installed presets and extensions;
- provider versions, priorities, enabled state, sources, and effective artifact
  stacks;
- current composition captured freshly for each Generate or Regenerate run.

The Wizard is authoritative for workflow selection and canvas identity:

- included phases and phase order;
- canvas ID, display name, workflow collection heading, and description;
- custom-slug behavior and installation-approval behavior;
- target and overwrite confirmation.
- immediate Add/Remove management of catalog-tagged Canvas Design presets,
  extensions, and design-only bundles in the Generate dialog.

The effective generation command may provide natural-language guidance and sparse
supported overrides for the generated application's experience:

- terminology and descriptive copy;
- slug and workflow-creation behavior;
- launch-time installation mode and setup-specific approval/readiness/recovery
  copy;
- result and clarification behavior;
- visual design and branding;
- information architecture and navigation;
- phase, artifact, and interaction presentation;
- onboarding, recovery, and status UX.

PR #32's compact Target, Extension ID, Name, Workflow header, Description, Allow
custom slug, and Require installation approval controls remain in the Generate
dialog and are written as exact structured request values. The installation
checkbox maps to `prompt` or `automatic`; `external` and optional bounded approval
copy remain advanced Canvas Design configuration. PR #32's result-label and
clarification controls do not remain common instance settings. Presets may replace
named experience templates exactly or modify `speckit.canvas.generate` to derive
supported values outside the compact request overlay. Canvas Design extensions may
replace named non-command templates or the renderer and add distinct
generation-support commands that are invoked explicitly.

The Generate dialog contains workflow confirmation, the compact PR #32 instance
form, overwrite/regenerate confirmation, and a Canvas Design catalog. The design
catalog uses the same immediate Add/Remove and community-confirmation behavior as
the existing Wizard Catalog. It does not stage a mixed package-management batch or
enumerate per-phase settings.

Neither side may alter protected runtime and security invariants.

## 16. Definition of done

- Canvas generation is installed and versioned as a Spec Kit extension.
- The same installed skill works from Copilot CLI and the Wizard.
- Copilot CLI users can generate and regenerate without installing or opening the
  Wizard by installing the generator and desired Canvas Design packages through
  Specify, reloading skills, and invoking `speckit-canvas-generate`.
- With no preset modification, the extension's default experience templates and
  base generation command reproduce PR #32's user-visible generated-app behavior,
  except that configured result tags are reported during the original phase turn
  through the generated canvas's protected `report_phase_result` action rather than
  through a second post-phase Copilot review.
- A preset can visibly change the generated application's terminology, look and
  feel, navigation, interactions, phase presentation, artifact experience, status
  model, and onboarding through command composition and named template
  replacement.
- A Canvas Design extension can contribute named non-command templates, a
  replacement renderer, and distinct explicitly invoked generation-support
  commands without appearing as a runtime workflow phase.
- `canvas-results` supports one optional result tag per phase, a PR #32-compatible
  global default with per-phase overrides, independent clarification/progress, and
  no automatic label inference.
- Every Generate and Regenerate captures current phase selection and current
  preset/extension composition without asking the model to reconstruct the
  artifact snapshot.
- The compact Generate form preserves PR #32's Target, Extension ID, Name,
  Workflow header, Description, Allow custom slug, and Require installation
  approval interaction and writes exact structured request values.
- Equivalent standalone natural-language input is normalized to the same request
  fields before `create-canvas`; materialization never interprets the original
  prose.
- Common instance settings do not expand with pipeline length; per-phase and
  domain-specific result customization remains in Canvas Design packages.
- The Generate dialog discovers presets, extensions, and design-only bundles by
  the catalog-level `canvas-design` tag while leaving the main Catalog focused on
  pipeline/runtime behavior.
- The required Canvas Generator Extension is installed through the Wizard
  Environment page, displayed as Added and Required in Canvas Design, and cannot be
  removed through the Generate dialog.
- Canvas Design Add installs one component immediately, Remove uninstalls one
  component immediately, and Generate performs no mixed package-management
  batch.
- A design-time `canvas-interactions` replacement can add a confirmation before a
  phase runs while a separate runtime preset composes the invoked phase command.
- Generated applications exclude `canvas-design` catalog entries from their
  runtime Catalog.
- Generated applications verify the compatible `spec-kit-copilot` plugin,
  `specify` CLI, Copilot-skills-mode initialization, and reload capability. They do
  not install the plugin or CLI; they may initialize the current project only
  after the destination user accepts the explicit `--force` warning.
- `external` supports folders prepared completely by a separate setup process;
  `prompt` and `automatic` may install only the exact captured runtime presets and
  extensions after the prerequisite gate passes.
- The Wizard live renderer and generator default renderer are independently owned,
  versioned, tested, and released; only the Canvas Runtime API contract is shared.
- A replacement renderer can use standard configuration defaults, existing
  Canvas Design provider configuration, and standard runtime state while adding new
  presentation elements.
- Renderer replacement requires no dependency on Wizard DOM structure, generated
  private routes, or backend persistence details.
- Renderer conformance tests protect the generated-runtime and isolated Wizard
  preview adapters without requiring visual parity with the Wizard's live renderer.
- All generated files have provenance and integrity hashes.
- Regeneration explicitly replaces the complete disposable generated-extension
  directory after confirmation. Durable customer modifications live in presets,
  Canvas Design extensions, or a separately owned repository location.
- Failed or partial output has no special recovery state; the user is prompted to
  Regenerate, which rebuilds, confirms exact-target deletion, deletes, and
  publishes through the same standard path.
- Generated canvases pass the migrated PR #32 runtime, security, and
  generated-behavior regression tests.
- A generated canvas works in a clean recipient repository without the Wizard.
- The implementation consumes public Spec Kit JSON/resolution contracts only.

## 17. Revised generation configuration and result behavior

This section supersedes the earlier six-category configuration, per-command
phase-output template, request-snapshot, and result-presentation proposals wherever
they conflict. It describes the intended behavior for **newly generated canvases
only**. Migrating canvases already generated with `canvas-theme`, `canvas-content`,
and the other existing categories is out of scope.

### Updated implementation plan

1. **Define three preset-replaceable and two generator-owned documents.** Add
   `schemaVersion: 1` to `canvas-presentation.json`, `phase-outputs.json`,
   `canvas-results.json`, `canvas-interactions.json`, and `canvas-setup.json`.
   Each has its own strict schema; an absent or unsupported version, missing
   required field, or unknown field fails generation with a useful error. A
   preset replaces an entire named document for the first three categories;
   there is no field-level merge. Unlike the other defaults, the effective
   phase-outputs default is generated from the selected pipeline's handoff,
   not loaded as a static empty exceptions file.
2. **Keep presentation limited to effective UI settings.** Consolidate the
   visual and copy settings that the generated app actually renders from
   today's theme, content, layout, and onboarding documents. Do not move
   progression, rerun, input, installation, slug, or result policies into
   presentation; do not carry forward accepted-but-unused fields merely because
   they exist. Setup failure messages and installation status are not
   customizable, and the redundant first-run hint is omitted. Canvas title,
   target, and setup policy remain per-app concerns. Action-button labels stay
   fixed rather than exposing only a partial set for customization. Slug field
   label and helper text live with slug policy in `canvas-setup.json`, not
   in presentation; its approval paragraph is `installationReviewMessage`.
3. **Resolve and consume the presentation document.** After the
   `create-canvas` scaffold, use Specify's
   `PresetResolver.resolve("canvas-presentation", template_type="template")`
   to select the extension default or active preset's complete JSON document.
   Validate it, place it in the generated app, and wire the UI to use it. A
   missing required named document fails visibly. Presets provide reusable
   whole-file replacement and take precedence over one-off inline documents
   for the same category when a **customer preset or Canvas Design extension**
   replaces the generator's own default. The built-in extension default is
   the baseline, not an enforcing provider. Neither route modifies Specify
   providers or introduces a project-local override path.
4. **Pass phase-artifact expectations explicitly.** The Wizard sends ordered
   command IDs and, for each, `expectsArtifact: true | false | null` and
   `outputPath: string | null`; `null` means unknown, not "no artifact."
   Preserve reusable `<slug>` paths rather than a current feature's concrete
   path. Rename the public handoff, configuration, request, blueprint, and
   generated-app artifact field consistently from `pathTemplate` to
   `outputPath`; keep placeholder expansion behavior. Standalone generation
   requires the same structured handoff and must mark unknowns rather than
   guess. Correct the Wizard's core defaults: Analyze, Taskstoissues, and
   Implement have **no direct artifact**.
5. **Make `phase-outputs` the complete effective map, not exceptions.**
   Build its default `{"schemaVersion":1,"byCommand":{...}}` from the Wizard
   handoff (or the equivalent standalone handoff), including **exactly** the
   selected commands in pipeline order. Each command has its own
   `{ "expectsArtifact": true | false | null, "outputPath": string | null }`
   entry, even if multiple commands share the same path and expectation.
   Do not group keys by shared values: separate entries allow independent
   editing and unambiguous ownership. A selected preset/extension may replace
   the whole map with the **same full-document format**, but its command keys
   must match the selected pipeline exactly; reject missing or extra keys
   with the offending command names rather than merging Wizard values or
   silently projecting a generic preset. An inline document cannot rescue a
   mismatched winning preset; remove or correct that preset. Validate
   all keys against the selected command inventory and preserve `false` with
   a null path. The current shipped empty exceptions template cannot serve as
   an effective default for a nonempty pipeline; retire it as an active
   document or treat it only as a seed for the derived default. The existing
   annotated `.jsonc` example remains optional standalone documentation, not
   a loaded default or Generate editor view. An expected path is not evidence
   of a file: **View artifact** requires a verified file, and explicit
   `false` suppresses it.
6. **Keep results as a distinct, versioned policy.** `canvas-results` remains
   whole-file preset-replaceable, with no optional custom results enabled by
   default. A configured command can define finite `(id, label, tone)` values,
   a `defaultResult`, `summary`, and either an `artifact-field` or
   `phase-report` source. `artifact-field` reads the specified
   opening-frontmatter field from a verified, fresh phase artifact in code.
   `phase-report` obtains an ID from the agent running that phase through the
   protected action. Neither `blocked` nor `needs-clarification` is inferred
   just from a configured label: the runtime needs the configured evidence.
   Built-in unresolved-clarification signaling and checkbox-based task
   progress remain distinct from optional result IDs.
7. **Enforce `phase-report` acceptance and freshness at runtime.** Accept only
   an ID declared for **that command on that run**, never any ID that happens
   to exist elsewhere in `canvas-results`. Bind acceptance to the active run
   and canvas instance. The first accepted ID wins; an identical retry is
   idempotent, while a conflicting ID is rejected. A rerun has a new run ID
   and cannot silently overwrite the previous run's report. Verify the
   intended reporting window in code; an instruction to report in the
   original agent turn is not, by itself, an enforced boundary. Suppress a
   settled report when its run fails, is superseded, has unresolved
   clarification, or becomes stale after an upstream rerun. Also declare the
   input artifacts whose contents govern each phase's result, capture their
   fingerprints for the run, and invalidate the report when those inputs
   change, for example Analyze's `no-issues-found` after its spec or tasks
   change. This guarantees freshness for **declared inputs**, not arbitrary
   undeclared files; unknown dependencies must not be presented as fully
   checked.
8. **Render the results the backend computes.** Show current phase-result
   pills, `summary: true` results, the configured clarification label, and
   task progress in the generated UI. Keep stale or unverified results out
   of both phase cards and summaries. Do not enable the separate agent-based
   artifact-review `resultLabels` feature implicitly.
9. **Validate the complete generation path.** Cover schema versions and
   preset replacement and exact selected-command matching; typoed and unknown
   command IDs; Wizard and standalone
   handoffs; no-artifact/unknown/verified-artifact states; per-command result
   IDs; duplicate, conflicting, late, and superseded reports; and input-file
   changes both with and without a tracked upstream rerun. Update the
   generator contracts and documentation to match the implemented behavior.
10. **Migrate schemas and scripts without dropping live behavior.** Replace
    presentation-only `canvas-theme`, `canvas-content`, and `canvas-layout` schemas
    with `canvas-presentation.schema.json`; retain/version any effective
    non-presentation policy split from `canvas-setup` and
    `canvas-interactions`. Update `canvas-results.schema.json` and the local
    `phase-outputs.schema.json`; retire the old per-command
    `phase-output.schema.json` format after updating request/pipeline `$ref`s.
    Retain and revise request, pipeline, snapshot, override, receipt, and result
    schemas that still validate live contracts. Replace six-category binding
    (`category_contracts.py`), refactor `experience.py` and `override.py`,
    rewrite `phase_output.py`, and update `request.py`, `compiler.py`,
    `staging.py`, `validation.py`, `receipt.py`, Wizard handoff, generated runtime,
    and UI as needed. Keep logo asset handling and publication/lifecycle scripts
    where their behavior remains in use; do not delete scripts solely because a
    configuration category changed.
11. **Limit scope to new generated apps.** Existing canvases generated with the
    old `canvas-theme`, `canvas-content`, and other category files are out of
    scope; only newly generated apps use this scheme.

### One-off JSON documents and Generate dialog

This addition supersedes the earlier Generate-dialog installation/slug
checkboxes and any presentation-only inline override proposal. It applies to
**new requests**, from either the Wizard or the standalone generation command;
it does not migrate already generated canvases. Keep the five files separate:
`canvas-presentation.json`, `phase-outputs.json`, `canvas-results.json`,
`canvas-interactions.json`, and `canvas-setup.json`.

1. **Accept up to five independent, complete inline documents.** The Wizard
   submits named structured JSON values for presentation, phase outputs,
   results, interactions, and setup. The generation command accepts explicit
   named JSON inputs for the same five categories, including JSON pasted into
   a natural-language request only when the agent passes each identified
   document to the corresponding structured input. Do not infer values from
   prose or accept an unlabeled JSON object as an override. Each supplied
   document must contain `schemaVersion: 1` and satisfy its entire category
   schema; reject sparse documents, unknown fields, unsupported versions,
   duplicate keys, nonfinite numbers, and invalid JSON with the category and
   offending field in the error. No implicit field-level merge with a provider
   or generator default is permitted. An absent category uses its normal
   resolved source.
2. **Make precedence explicit per category.** Start from the generator or
   extension default, replace it with a complete one-off document when
   supplied, then let Specify's active **customer preset or Canvas Design
   extension** replace that entire document if it contributes the **same
   named category**. The generator's own extension default is the baseline;
   it must not override inline input. Do not
   merge at field or section level: an entire inline document loses even
   when the provider differs in only one field. For phase outputs, the
   generator default is the full selected-command handoff; a customer provider
   winner must be a full map for precisely that pipeline. Resolve the
   Specify winner for presentation, phase outputs, and results **even when
   inline JSON is supplied**, distinguishing a customer replacement from
   the built-in extension default. The phase-outputs extension default is
   derived rather than loaded as the old empty exceptions template.
   Interactions and setup use generator-owned defaults or inline documents,
   not Specify resolution. Neither inline editing nor removing a draft
   modifies installed packages or files. Strictly validate supplied JSON
   even if a provider supersedes it; validate cross-document behavior and
   workflow-command constraints against the **effective winners**.
3. **Use JSON alone for setup policy.** Change the shipped `canvas-setup.json`
   defaults to `installationMode: "prompt"` and
   `workflowSlug.userProvided: true`. Remove the Wizard's installation-approval
   and custom-slug checkboxes and stop overlaying
   `instanceConfiguration.installationMode` and
   `instanceConfiguration.workflowSlug.userProvided` onto the setup document.
   Change either behavior for a particular canvas only through a complete
   inline setup document; display name, workflow header, description, and
   extension ID remain ordinary generation fields. Update the new-request
   schema, standalone path, and handoff together so the removed overlay cannot
   override an inline setup document. Preserve the existing explicit errors
   and permission checks for package installation.
4. **Bind the final documents to the immutable request.** Strictly parse and
   validate inline inputs in `prepare-request`, store the validated documents
   under their named categories in the request, and use those saved values
   during staging and regeneration, never a later chat message or changed
   editor draft. Record `inline` as the final source with a document hash
   only when no higher-priority customer provider wins that category. Otherwise
   record the provider as the final source and separately record the
   submitted inline document and that it was superseded, without claiming
   it was materialized. Verify both cases in binding and receipt validation.
   Regeneration replays saved inputs and the same precedence; if a provider
   changes, use the captured provider/snapshot contract or report drift,
   never silently produce different content. Inline presentation may
   customize non-asset settings and select `brand.logo.mode: "default"` or
   `"hidden"`; reject inline `mode: "asset"` with an actionable error until
   explicit inline assets are supported. When a provider wins, its **whole**
   presentation wins, including its bundled asset logo; no borrowing or
   rewriting `default`/`hidden` is needed. A preset/extension may use `mode: "asset"`
   only when its declared `path` names an actual confined image in that same
   installed provider; validate its type, dimensions, and size, then copy and
   hash it into the generated canvas. The accepted hidden-logo mode is
   `hidden` throughout schema and UI.
5. **Keep Generate to Details and Canvas Design, with no Review step.**
   Details contains the extension ID (and derived target), name, workflow
   header, and description. Canvas Design contains the existing searchable
   preset/extension/bundle picker, with its long list independently scrollable,
   followed by an optional **One-off JSON overrides** area listing all five
   documents. Each row shows Add/Edit and its current source or validation
   state; open one focused editor at a time rather than five textareas at once.
   Seed a newly opened editor with the complete generator/extension baseline
   **before any preset replacement**, including all selected commands for
   phase outputs. Show the provider winner separately when one is active;
   do not pre-fill with a preset asset-logo document invalid as inline input.
   For 20–50 commands, keep the document searchable and
   navigable without grouping shared paths into a new JSON format. Merely
   viewing the pre-filled document, or editing it and returning to the same
   parsed values, creates **no** inline input: generate with the baseline
   or provider source and provenance. Only a semantic change saved in the
   editor creates a complete request-scoped inline document. A mismatched
   phase-outputs preset remains an error even when inline JSON is supplied.
   The editor accepts strict JSON only; do not add JSONC/comment stripping,
   read-only example panes, or separate example
   documents to the Generate UI. The existing standalone annotated
   `phase-outputs.example.jsonc` remains documentation, never an active
   template or editor input. Editing or removing the inline copy never edits
   the provider. If packages change afterward, do not silently replace a
   drafted inline document. Preserve unsent details/JSON while navigating
   between the two steps; Cancel discards those drafts.
6. **Show sources without another confirmation screen.** At the bottom of
   Canvas Design, show a compact per-category **Configuration used** summary
   identifying `Preset/extension`, `One-off JSON`, or `Generator default`.
   If a changed one-off document and the active customer Specify winner target the
   same category, warn beside the editor and in the summary: **the provider
   replaces the entire one-off document**, not only fields that differ.
   Identify the winning package and category; do not warn for unrelated
   packages or non-winning providers. Keep the draft editable, but never
   suggest its overridden values will appear in the generated canvas.
   Validate each editor
   before Generate, disable Generate for invalid or pending inputs, and take
   users directly to the offending editor with a specific error. Keep the
   existing overwrite confirmation only if the target exists. Add/Remove in
   the package picker continues to mutate installed packages immediately;
   label this beside those controls, state that Cancel cannot undo it, and do
   not represent package changes and JSON drafts as one transaction. Wait for
   pending package mutations and refresh effective sources before generating.
   On narrow screens, retain the same two steps with a usable scrolling
   package list or active editor.
7. **Test the actual handoff and replay.** Cover all five categories
   independently and in combination, default and package winners,
   provider-over-inline precedence, category-level conflict warnings,
   truthful receipt provenance for superseded inputs, complete versus
   partial/invalid JSON, cross-document checks,
   exact phase-command sets, shared output paths, 20–50 selected commands,
   unchanged editor values producing no override, direct command and Wizard
   request creation, removal/editing of a draft,
   package changes while an inline draft exists, setup defaults and explicit
   inline policy, asset-logo rejection, per-source receipt/hash drift, and
   regeneration after package state changes. Update the command guidance,
   request/binding/receipt schemas, generated-app documentation, and Wizard
   tests. Reconcile the incomplete presentation-only `presentationOverride`
   patch with the unified five-document request contract rather than
   extending that special case.

**Decisions confirmed for this iteration:** package Add/Remove remains
immediate and Cancel does not undo it; an active provider's complete
document takes precedence over one-off input in the same category, with
a category-level warning for edited but superseded input. The preset's
bundled logo stays intact when its presentation wins; inline JSON cannot
supply a custom image when no provider wins. The strict-JSON editor starts
from the generator/extension baseline before preset replacement; no
example view is planned. These are planned contracts, not already
implemented functionality.
