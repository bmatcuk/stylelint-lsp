function extend(config, { extends: exts, plugins, rules, parserOptions, env, ...newConfig }) {
  if (exts) {
    if (!Array.isArray(exts)) {
      exts = [exts]
    }
    exts.forEach(p => {
      // @typescript-eslint configs each "extends" "./config/base.json"...
      // eslint magically handles those, but that functionality is not
      // exported, so, I'm just going to make this hacky...
      const extendedConfig =
        p === "./configs/base.json"
        ? require("@typescript-eslint/eslint-plugin").configs.base
        : require(`eslint-config-${p}`)
      config = extend(config, extendedConfig)
    })
  }
  if (plugins) {
    config.plugins = config.plugins ? [ ...config.plugins, ...plugins ] : plugins
  }
  if (rules) {
    config.rules = { ...config.rules, ...rules }
  }
  if (parserOptions) {
    config.parserOptions = { ...config.parserOptions, ...parserOptions }
  }
  if (env) {
    config.env = { ...config.env, ...env }
  }
  return { ...config, ...newConfig }
}

function override(files, ...configs) {
  let config = { files }
  configs.forEach(c => { config = extend(config, c) })
  return config
}

module.exports = {
  parserOptions: {
    ecmaVersion: 6,
  },
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended"
  ],
  overrides: [
    override(
      ["*.js?(x)"],
      require("eslint-plugin-prettier").configs.recommended,
    ),
    override(
      ["*.ts?(x)"],
      require("@typescript-eslint/eslint-plugin").configs.recommended,
      require("eslint-plugin-prettier").configs.recommended,
      require("eslint-config-prettier/@typescript-eslint"),
      {
        parserOptions: {
          ecmaVersion: 8,
          project: "./tsconfig.json",
        },
        rules: {
          "@typescript-eslint/explicit-function-return-type": [
            "warn",
            {
              "allowExpressions": true,
              "allowTypedFunctionExpressions": true,
            },
          ],
          "@typescript-eslint/explicit-member-accessibility": [
            "error",
            { accessibility: "no-public" },
          ],
        },
      },
    ),
    // override(
    //   ["*.test.{j,t}s?(x)"],
    //   {
    //     ...require("eslint-plugin-jest").configs.recommended,
    //     env: { jest: true },
    //   },
    // ),
  ],
}
