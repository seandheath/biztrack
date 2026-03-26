{
  description = "BizTrack — Business Expense & Mileage Tracker PWA";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js 22 LTS — matches CI (deploy.yml node-version: '22')
            nodejs_22
          ];

          shellHook = ''
            echo "BizTrack dev environment"
            echo "  node $(node --version)"
            echo "  npm  $(npm --version)"
            echo ""
            echo "Run 'npm install' if node_modules is missing."
            echo "Run 'npm run dev' to start the Vite dev server."
          '';
        };
      });
}
