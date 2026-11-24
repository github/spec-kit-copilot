---
name: speckit-designer-preview
description: "Open a sample-only Spec Kit Canvas Designer UX preview without a Wizard handoff. USE FOR: inspecting local Designer layout and badge editing changes. DO NOT USE FOR: project setup, package installation, template resolution, saving, generation, or validating a functional Designer launch."
argument-hint: "[optional UX change to inspect]"
---

# Preview the Designer interface

Open the installed Spec Kit Canvas Designer provider once:

`open_canvas({canvasId:"speckit-canvas-designer",extensionId:"plugin:spec-kit-copilot-wizard:speckit-canvas-designer",instanceId:"designer-ux-preview",input:{preview:true}})`

The preview displays illustrative badge types, phases, and output paths. It does not
read a Wizard handoff, inspect installed packages, resolve Specify templates,
save settings, or generate an app. Its sample edits last only while the panel
is open. Do not run the normal Canvas Design load-page skill or assert that
the functional Designer is ready based on this preview.

If the current worktree's provider changes are not installed, explain that the
preview will reflect the installed provider, not the newest checkout source.
Refresh the installed provider only when the user has approved local-source
testing and after following the installed-refresh skill.
