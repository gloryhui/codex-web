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
    version = "0.156.1";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-iYI901A2TV4MuKdMHqWF7CtzB5MdncCsQZW4vI+eLfo=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-n+4m5z9aJLawVwRvDb5hn5S7AkuTTid/VPSTTQgUVNA=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-PKPDqF4YRZTQtmXqkCi8OMSuiWkehu2+79LG9Yl5/LQ=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-3tmEC6vrUR55c4rnCARK5In7zlDbcAK5Q7MZXPWuaiU=";
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
