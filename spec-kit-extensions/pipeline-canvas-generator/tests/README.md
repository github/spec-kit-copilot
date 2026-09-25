# Generator tests

Use Python's standard-library test runner for extension-owned contract and
integration tests:

```powershell
python -m unittest discover -s .\spec-kit-extensions\pipeline-canvas-generator\tests -p "test_*.py"
```

The baseline generation source and Assess, Bugfix, and SDD fixtures are pinned
in the [extension README](../README.md). Port those fixtures before accepting
compiler behavior; do not fabricate their expected results. The existing
Wizard's JavaScript tests continue to use its `node --test` runner:

```powershell
npm test --prefix .\plugins\spec-kit-copilot-wizard\extensions\speckit-wizard-canvas
```

No additional test framework is required. Generation is intentionally
unavailable until the request and final-output contracts are validated.
