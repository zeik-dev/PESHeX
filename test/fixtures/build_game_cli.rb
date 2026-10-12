#!/usr/bin/env ruby
# Genera la carpeta de juego sintetica de make_game_folder.rb desde la linea de
# comandos (la usan las pruebas e2e) e imprime un manifiesto JSON:
#   ruby test/fixtures/build_game_cli.rb <carpeta> <save.rxdata> [TORRACAT=Nombre ...]
require 'json'
require_relative '../../driver/rxdata_driver'
require_relative 'make_game_folder'

dir, save, *renames = ARGV
names = renames.to_h { |r| r.split('=', 2) }
GameFixture.build(dir, from: save, names: names)

_state, facts = GameFixture.facts_from(save)
manifest = {
  species: facts.map { |f| [f.species, f.form] }.uniq,
  items: facts.flat_map { |f| [f.item] }.compact.uniq + GameFixture::EXTRA_ITEMS,
  balls: facts.map(&:ball).compact.uniq
}
puts JSON.generate(manifest)
