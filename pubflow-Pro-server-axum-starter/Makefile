.PHONY: changelog test fmt clippy check build-native build-wasm build-artifacts setup-db

changelog:
	git cliff -o CHANGELOG.md
	@echo "CHANGELOG.md updated!"

test:
	cargo test --workspace

fmt:
	cargo fmt --all

clippy:
	cargo clippy --workspace --all-targets -- -D warnings

check: fmt clippy
	@echo "✅ All checks passed!"

build-native:
	./scripts/build-native.sh

build-wasm:
	./scripts/build-wasm.sh

build-artifacts: build-native build-wasm
	@echo "✅ Native and WASM artifacts built under dist/"

setup-db:
	@./scripts/setup-db.sh
