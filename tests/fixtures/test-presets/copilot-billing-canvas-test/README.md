# Billing Canvas Design test preset

This repository-local fixture is not in the published preset catalog. It appends
the Billing page and cost-code contribution names to the composed `load-page`
command. Both files must be explicitly resolved; an unregistered page file
does not create a Designer tab.

The contribution currently targets `essentials.options`. To place the **same**
`billing.costCode` field on Billing instead, override the named
`canvas-contributions-billing` template with `"slot": "billing.options"`.
Only one placement may be registered at a time. Both slots accept ordered
fields; the field ID, 64-character bound, save/reopen behavior, and generated
read-only value remain identical. The `generatedBinding.section` independently
sets the generated display heading to **Billing**; it does not change the
Designer slot. Fields without a section retain the default **Configured fields**
heading. Multiple sections may share a title, but a section ID must keep the
same title across contributing fields. No stock adapter JavaScript is needed:
`stock.text` and `stock.readonly` select built-in renderers.
