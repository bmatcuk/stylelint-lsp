/** Commands */
export enum CommandIds {
  applyAutoFixes = "stylelint.applyAutoFixes",
}

/** Commands specifically for disabling rules */
export enum DisableRuleCommandIds {
  applyDisableRuleInline = "stylelint.applyDisableRuleInline",
  applyDisableRuleToFile = "stylelint.applyDisableRuleToFile",
  applyDisableRuleToLine = "stylelint.applyDisableRuleToLine",
  applyDisableRuleToRange = "stylelint.applyDisableRuleToRange",
}

/** Titles of the commands */
export const CommandTitles: Record<
  CommandIds | DisableRuleCommandIds,
  string
> = {
  [CommandIds.applyAutoFixes]: "Apply all stylelint fixes",
  [DisableRuleCommandIds.applyDisableRuleInline]:
    "Disable stylelint rule inline",
  [DisableRuleCommandIds.applyDisableRuleToLine]:
    "Disable stylelint rule on this line",
  [DisableRuleCommandIds.applyDisableRuleToFile]:
    "Disable stylelint rule for entire file",
  [DisableRuleCommandIds.applyDisableRuleToRange]:
    "Disable stylelint rule for selection",
}
