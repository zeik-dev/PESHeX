# =============================================================================
# make_legacy_save.rb — Genera saves SINTETICOS con la forma de bases antiguas
# de Essentials (v16-v18) y variantes custom, para probar la deteccion por
# perfiles/forma sin necesitar saves reales (que todavia no tenemos).
#
# La forma esta basada en el conocimiento del motor (varios Marshal.dump
# consecutivos, IDs enteros, @iv/@ev como Array de 6 en orden PBStats, bolsa con
# [id_int, cantidad]); hay que contrastarla con saves reales cuando existan.
#
#   LegacyFixture.build                      # v16-v18 estandar (@pockets)
#   LegacyFixture.build(bag_ivar: '@bag')    # variante con la bolsa en @bag
#   LegacyFixture.build(empty_bag: true)     # bolsa completamente vacia
#   LegacyFixture.build(extra_root: ...)     # root extra desconocido
# =============================================================================

module LegacyFixture
  CLASSES = %w[
    PokeBattle_Pokemon PBMove PokeBattle_Trainer PokemonBag PokemonStorage PokemonBox
    PokemonGlobalMetadata PokemonMapMetadata Game_System PokemonSystem Game_Switches Game_Variables
    Game_SelfSwitches Game_Screen PokemonMapFactory Game_Player ModdedThing
  ].freeze

  def self.define_classes
    CLASSES.each do |name|
      Object.const_set(name, Class.new) unless Object.const_defined?(name)
    end
  end

  def self.obj(name, **ivars)
    define_classes
    o = Object.const_get(name).allocate
    ivars.each { |k, v| o.instance_variable_set("@#{k}", v) }
    o
  end

  def self.move(id, pp)
    obj('PBMove', id: id, pp: pp, totalpp: pp, ppup: 0)
  end

  def self.pokemon(species, level, nickname = nil)
    obj('PokeBattle_Pokemon',
        species: species, level: level, exp: level**3, name: nickname, item: 0, happiness: 70,
        moves: [move(33, 35), move(45, 40), move(0, 0), move(0, 0)].first(2),
        iv: [31, 20, 10, 5, 15, 25], ev: [0, 252, 0, 4, 252, 0],
        hp: 40 + level, totalhp: 40 + level, attack: 30 + level, defense: 25 + level,
        speed: 28 + level, spatk: 27 + level, spdef: 26 + level,
        personalID: 123_456_789 + species, trainerID: 12_345, ot: 'Red', eggsteps: 0,
        ballused: 4, status: 0, statusCount: 0, natureflag: nil, abilityflag: nil, genderflag: nil)
  end

  def self.bag(ivar, empty)
    pockets = Array.new(9) { [] }
    unless empty
      pockets[1] = [[17, 5], [18, 2]]
      pockets[2] = [[68, 10]]
      pockets[8] = [[258, 1]]
    end
    obj('PokemonBag', ivar.delete('@') => pockets, lastpocket: 1, choices: Array.new(9, 0), registeredItems: [])
  end

  def self.storage
    boxes = Array.new(3) do |i|
      slots = Array.new(30)
      slots[0] = pokemon(129 + i, 5 + i) if i.zero?
      obj('PokemonBox', name: "Box #{i + 1}", background: i, pokemon: slots)
    end
    obj('PokemonStorage', boxes: boxes, currentBox: 0, boxmode: -1)
  end

  # Pokedex como lo guardan las bases v16-v18 / Infinite Fusion: arrays por numero de especie dentro del trainer.
  # `:alt` usa otros nombres de ivar. El de capturados es mas corto a proposito (la base lo agranda al capturar).
  def self.dex_ivars(kind)
    seen = Array.new(152, false)
    [4, 25, 129].each { |n| seen[n] = true }
    owned = Array.new(26, false)
    owned[25] = true
    kind == :alt ? { seen_species: seen, caught: owned } : { seen: seen, owned: owned }
  end

  def self.build(bag_ivar: '@pockets', empty_bag: false, extra_root: nil, dex: nil)
    define_classes
    trainer = obj('PokeBattle_Trainer', name: 'Red', id: 12_345, trainertype: 0, money: 3000,
                                        badges: [true, true, true] + [false] * 5,
                                        party: [pokemon(25, 12, 'Sparky'), pokemon(4, 15)],
                                        **(dex ? dex_ivars(dex) : {}))
    roots = [
      trainer, 123_456, obj('Game_System'), obj('PokemonSystem'), 7, obj('Game_Switches', data: [nil, true]),
      obj('Game_Variables', data: [nil, 0, 5]), obj('Game_SelfSwitches', data: {}), obj('Game_Screen'),
      obj('PokemonMapFactory'), obj('Game_Player'), obj('PokemonGlobalMetadata', coins: 250, bicycle: false),
      obj('PokemonMapMetadata'), bag(bag_ivar, empty_bag), storage
    ]
    roots << extra_root if extra_root
    roots.map { |r| Marshal.dump(r) }.join.b
  end
end
