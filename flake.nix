{
  inputs = {
    nixpkgs = {
      type = "github";
      owner = "NixOS";
      repo = "nixpkgs";
      ref = "nixos-unstable";
    };
  };

  outputs = {
    nixpkgs,
    self,
    ...
  }: let
    supportedSystems = ["x86_64-linux"];

    perSystem = attrs:
      nixpkgs.lib.genAttrs supportedSystems (system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in
        attrs system pkgs);
  in {
    packages = perSystem (system: pkgs: {
      default = self.packages.${system}.stylelint-plus;

      stylelint-plus = pkgs.callPackage ({buildNpmPackage, ...}:
        buildNpmPackage {
          name = "stylelint-plus";
          src = ./.;

          npmDepsHash = "sha256-O7++9OrLWDqzWYUN9LqUGgQaq0pMrp4/PZtxw4J9TZY=";
        }) {};
    });

    formatter = perSystem (_: pkgs: pkgs.alejandra);
  };
}
