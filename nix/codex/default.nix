{
  flake-utils,
  nixpkgs,
  ...
}:
let
  systems = [
    "aarch64-darwin"
    "x86_64-darwin"
    "aarch64-linux"
    "x86_64-linux"
  ];
in
flake-utils.lib.eachSystem systems (
  system:
  let
    pkgs = import nixpkgs { inherit system; };
    version = "0.165.0";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-qZGwq8trbSrk0CIbVd10r+i4eEcERIPsaNKQkIpaD5c=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-MR4eqjjkA+SAhS0bSKer6P2zDNvfYFI8Nj39ydxNqBg=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-yZVYCONZgZiv4bhSW1hkwOPyR3M50m6Rkk6V7UVHO68=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-+ZfNbvWYcSbhnNPILoR6SmRhJw8y+XNAxemaZftvm4o=";
        };
      }
      .${system};
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@openai/codex/-/codex-${version}-${platform.npm}.tgz";
      hash = platform.hash;
    };
  in
  {
    packages.codex =
      pkgs.runCommand "codex-${version}"
        {
          pname = "codex";
          inherit src version;
        }
        ''
          tar -xzf "$src"
          # Preserve the CLI package layout: binaries resolve codex-package.json,
          # codex-path and codex-resources relative to their installation root.
          mkdir -p "$out"
          cp -R package/vendor/*/. "$out/"
        '';
  }
)
