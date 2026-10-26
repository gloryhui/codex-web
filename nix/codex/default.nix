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
    version = "0.164.0";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-m1o1vhl1zrMy6vJ0Ay83WwF6tkT/AWVzfq0DJ3+ud80=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-d7aTBP5L6Sz1KutvBJO/YO0BFH4hUYTXnXSouZYpPCk=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-BIpicxziiqAAUI78wDIwLlhIjKB5lw3K4G0o3zmuXOA=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-YmWf79mo76IaSWQC/ePBHAJbvu5zWlgpaPj/0Uy195w=";
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
