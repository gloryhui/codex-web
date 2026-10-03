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
    version = "0.159.2";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-TkkUKP7wpnb47RxrOSGDwkeTlAyVj6HnvZnby5gtfMY=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-TWmxrRQl/5Jn1xj/zAKJzQTM9mvBh63iJn6onjukxMU=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-HEdWwvZ/ExD/sDI01h1UCthZFs71OD5G4OeFHxchwUI=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-hKazX7Rb3LlM75/LMpQ4BFqJEfU4dsyamn5vm7E4Lro=";
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
