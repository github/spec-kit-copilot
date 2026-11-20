// Shared readiness contract for phase submission and the Wizard UI.
export function isPhaseSetupReady(snapshot) {
    const setup = snapshot?.setup ?? {};
    const environment = snapshot?.environment ?? {};
    return Boolean(environment.pluginInstalled || setup.pluginInstalled) &&
        Boolean(environment.cliInstalled || setup.cliInstalled) &&
        Boolean(snapshot?.projectInitialized || setup.projectInitialized) &&
        Boolean(setup.skillsReloaded);
}
