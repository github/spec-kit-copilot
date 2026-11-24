const PROPERTY_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;

export function validControlContract(contract) {
    if (!contract || typeof contract !== "object" || Array.isArray(contract)
        || Object.keys(contract).sort().join() !== "properties,type"
        || contract.type !== "object"
        || !contract.properties || typeof contract.properties !== "object"
        || Array.isArray(contract.properties)) return false;
    const properties = Object.entries(contract.properties);
    return properties.length > 0 && properties.length <= 10
        && properties.every(([key, allowed]) => PROPERTY_PATTERN.test(key)
            && Array.isArray(allowed) && allowed.length > 0 && allowed.length <= 20
            && new Set(allowed).size === allowed.length
            && allowed.every((option) => typeof option === "string"
                && option.length > 0 && option.length <= 80));
}

export function validControlValue(value, contract) {
    if (!validControlContract(contract) || !value || typeof value !== "object"
        || Array.isArray(value)) return false;
    const properties = Object.entries(contract.properties);
    return Object.keys(value).length === properties.length
        && properties.every(([key, allowed]) => Object.hasOwn(value, key)
            && allowed.includes(value[key]));
}
