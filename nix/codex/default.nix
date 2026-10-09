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
    version = "0.162.0";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-5ifWQDzjG9pX1XYpoAhqVl1fa1exVKupLhydskY4dOs=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-bhWRe+AUX1xjE58YcDqLFt7hBBNRaXVC0P5MgL9Dbm0=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-AJYPU0ALCD69KsxFKbLOFtW6+W2ak8NmUFUToe2KpVg=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-29NC562JbVPbtQXpJvG4IxS3mp0z4gmwt2Fs7WsGyYM=";
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
          install -Dm755 package/vendor/*/bin/codex "$out/bin/codex"
          install -Dm755 package/vendor/*/bin/codex-code-mode-host "$out/bin/codex-code-mode-host"
        '';
  }
)
