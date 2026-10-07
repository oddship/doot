{
  description = "Doot local development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  # Node 23 is no longer available in current nixpkgs.
  inputs.nixpkgs-node23.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs, nixpkgs-node23 }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          node23Pkgs = import nixpkgs-node23 { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ node23Pkgs.nodejs_23 ] ++ (with pkgs; [ just sqlite chromium pkg-config python3 ]);
            shellHook = ''
              export CHROMIUM_PATH="${pkgs.chromium}/bin/chromium"
              export DOOT_HOST="''${DOOT_HOST:-127.0.0.1}"
              export DOOT_PORT="''${DOOT_PORT:-8765}"
            '';
          };
        });
    };
}
