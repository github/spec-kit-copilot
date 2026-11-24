<!-- speckit:risk-matrix-test v1 -->
## Additional Canvas Design templates

- `canvas-control-risk-matrix` — `shared.control-definition`, `replace`
- `canvas-contributions-risk-designer` — `designer.setting-definition`, `replace`
- `canvas-control-risk-matrix-designer` — `designer.control-adapter`, `replace`
- `canvas-control-risk-matrix-generated` — `generated.control-adapter`, `replace`

## Risk-matrix resolution requirements

Resolve all four names through the base command, from the Designer child
project root, and open Designer once with the complete inventory. The Designer
field placement and its explicit generated binding in `details.content`, plus
both host-specific adapters, are mandatory. An unresolved,
wrong-kind, invalid, or non-replace adapter is an error, not a request to
fall back to stock text. The generated adapter must be packaged locally
with the generated app; the app must not resolve this preset at runtime.
