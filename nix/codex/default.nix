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
    version = "0.163.0-alpha.11.1";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-J8Yno6V++pfHms6igQUsRvmxfrldiGJPgPDQe49gsUw=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-aKZjOjJdOn1m5T+djut5s16S9AieTOdgr8oimW4zynU=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-N404v6qHQC9AiZpACJK4rr6nJQmzxMXVohY5qVjYtQk=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-qgshaYHYPrAhrH4u1uwe1reCPd2OceaQWm7O75vi2Xk=";
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
