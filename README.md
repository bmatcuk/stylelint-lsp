[![Release](https://img.shields.io/npm/v/stylelint-lsp.svg)](https://www.npmjs.com/package/stylelint-lsp)
[![Build Status](https://travis-ci.com/bmatcuk/stylelint-lsp.svg?branch=master)](https://travis-ci.com/bmatcuk/stylelint-lsp)
[![codecov.io](https://img.shields.io/codecov/c/github/bmatcuk/stylelint-lsp.svg?branch=master)](https://codecov.io/github/bmatcuk/stylelint-lsp?branch=master)

# stylelint-lsp
stylelint-lsp is an implementation of the [Language Server Protocol] for
[stylelint]. It supports the following features:

* Document formatting, like running `stylelint --fix` on the file.
* Commands to disable stylelint rules inline, above the line, for the entire
  file, or surrounding a block.
* Linting on change or on save

Formatting (ie, `stylelint --fix`) can be configured to run automatically on
save, in response to format requests, or run manually using a command.

## Client Implementations
* [coc-stylelintplus]: a client for [coc.nvim]
* [nvim-lspconfig]: configs for [neovim]'s built-in lsp support

## Settings
* **autoFixOnFormat** (default `false`) - automatically apply fixes in response
  to format requests.
* **autoFixOnSave** (default `false`) - automatically apply fixes on save.
* **config** (default `null`) - stylelint config to use.
* **configFile** (default `null`) - path to stylelint config file.
* **configOverrides** (default `null`) - stylelint config overrides.
* **enable** (default `true`) - if false, disable linting and auto-formatting.
* **validateOnSave** (default `false`) - lint on save.
* **validateOnType** (default `true`) - lint after changes.

If neither **config** nor **configFile** are specified, stylelint will attempt
to automatically find a config file based on the location of the file you are
editing.

If both **validateOnSave** and **validateOnType** are set to `false`, no
linting will occur but auto-fixes can still be applied if you have it enabled.
**validateOnSave** is automatically enabled if you enable **autoFixOnSave**
because revalidation must occur after fixes are applied. You may wish to
explicitly turn on **validateOnSave** if you are using another editor extension
that will make changes to the file on save, otherwise, diagnostic messages from
stylelint may be out-of-date after a save (ie, may point to the wrong line or
may have been fixed by the automatic changes on save, etc).

## Inspiration
Some ideas were borrowed from [vscode-eslint] and [coc-eslint].

[Language Server Protocol]: https://microsoft.github.io/language-server-protocol/
[coc-eslint]: https://github.com/neoclide/coc-eslint
[coc-stylelintplus]: https://github.com/bmatcuk/coc-stylelintplus
[coc.nvim]: https://github.com/neoclide/coc.nvim
[neovim]: https://github.com/neovim/neovim
[nvim-lspconfig]: https://github.com/neovim/nvim-lspconfig
[stylelint]: https://stylelint.io/
[vscode-eslint]: https://github.com/Microsoft/vscode-eslint
