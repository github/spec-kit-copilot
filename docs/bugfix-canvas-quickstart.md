# Bug-fix canvas quick start

This guide creates a canvas for the Spec Kit bug workflow. Keep the accompanying
[badge configuration](bugfix-canvas-badges.json) beside this guide.

The catalogs point to published package archives, not the contents of a development
branch. The Canvas Design extension and vertical preset used here are local
development sources and have not been published to the catalogs. You can still
use a catalog to install the `bug` extension.

## How customization works

Spec Kit extensions and presets make Designer and its generated canvases
customizable through contributed templates, without editing Designer itself.

- **Canvas Design extension:** supplies the default Designer pages, controls,
  badge definitions, and canvas generator.
- **Presets:** add or replace contributed templates. For example, the vertical
  preset changes the generated canvas's phase control and adds Autopilot; without
  it, the standard horizontal control is used.
- **Bug extension:** supplies the Assess, Fix, and Test workflow skills; it does
  not define the canvas layout.

## 1. Prepare

1. Check out `canvas-designer-v1`:

   ```powershell
   git clone --branch canvas-designer-v1 https://github.com/github/spec-kit-copilot.git
   cd spec-kit-copilot
   git rev-parse HEAD
   ```

2. Use the Copilot app with the Spec Kit Copilot skills and Wizard plugin
   installed. Ensure `specify --version` works; Canvas Design requires Specify
   1.0.7 or later. If the CLI is missing, ask Copilot to use `speckit-cli-setup`.
3. Use a disposable test workspace. The Fix phase can modify source code.

## 2. Open Wizard and remove the default preset

1. Start a Copilot session rooted at the branch checkout and ask Copilot to run
   `dev-tools-speckit-wizard-local-generate-launch`. This refreshes the installed
   Wizard and Designer providers from that checkout and opens Wizard with Generate
   enabled. Review any overwrite approval the helper requests.
2. Complete Wizard initialization. It may install **Copilot Sub-Agent
   Delegation** (`copilot-sub-agents`) by default. This preset adds delegation
   guidance to Spec Kit skills; it is separate from the vertical layout preset.
3. To work around the known error, go to **Setup > Catalogs > Presets**, find
   **Copilot Sub-Agent Delegation**, and select **Remove**. Confirm that it is no
   longer active. Do not rerun initialization or **Install default presets**
   afterward, since those can add it back.

## 3. Select the workflow and local packages

1. In **Setup > Catalogs > Extensions**, install `bug` if it is not already
   installed. It provides the Assess, Fix, and Test skills.
2. Select the three bug phases in order: `speckit.bug.assess`,
   `speckit.bug.fix`, and `speckit.bug.test`. Confirm their outputs are
   `assessment.md`, `fix.md`, and `test.md` under `.specify\bugs\<slug>\`.
3. Open **Design > Open Designer** and expand **Local development**. Enter the
   absolute path below, select **Add**, and keep it checked:

   ```text
   <branch-checkout>\spec-kit-extensions\extension-canvas-design
   ```

   Canvas Design supplies Designer settings and generates the canvas. The current
   local-development control takes a typed path; it does not have a folder picker.
   The local selection overrides a catalog selection with the same package ID.
4. Choose one layout:

   - **Vertical with Autopilot:** add and check
     `<branch-checkout>\spec-kit-presets\copilot-vertical-phase-control`.
     This preset replaces the phase control with numbered vertical steps and adds
     an Autopilot action.
   - **Normal layout:** do not add or enable the vertical preset. The stock
     horizontal phase control remains. Use a separate clean project when testing
     both layouts, and confirm the vertical preset is not already installed there.

   Then select **Launch designer**.

## 4. Import badges and generate

1. In Designer, enter a unique Canvas ID and title.
2. Open **Badges**, choose **Import badges**, and select
   [bugfix-canvas-badges.json](bugfix-canvas-badges.json) from this guide's
   folder. Click **Save**.
3. Badges are visual labels based on workflow outputs, such as severity, verdict,
   test result, and phase completion. The file is a generated-configuration envelope
   for import; only its badge instances are added. It does not install packages or
   copy the source canvas.
4. Choose **Generate**, then **Open**. Create a small bug in the disposable
   workspace and run Assess, Fix, and Test. With the vertical layout, also try
   Autopilot and Stop. Badges appear when their configured outputs and matching
   text are present.
