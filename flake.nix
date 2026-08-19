{
  description = "Doot local development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [ nodejs_22 just sqlite chromium pkg-config python3 ];
            shellHook = ''
              export CHROMIUM_PATH="${pkgs.chromium}/bin/chromium"
              export DOOT_HOST="''${DOOT_HOST:-127.0.0.1}"
              export DOOT_PORT="''${DOOT_PORT:-8765}"
            '';
          };
        });
    };
}
