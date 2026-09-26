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
    version = "0.157.1";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha256-xRlmQPLl4cmk4aHBJHrTLwy+axnnBj2znRIEMGNEsoM=";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha256-d7JsAPU5jGGfiwNgkrBkrn/+Q5GuO1NwxFf5PGTpAIw=";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha256-tz1ILAljpp1c7OX+FukZRzNZk3wi+0SZcC6jWHDhgk8=";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha256-fxJnd0D0Of5IhMcDHZ1wPlcc7PXqn6OgWr0bvMwhYqg=";
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
