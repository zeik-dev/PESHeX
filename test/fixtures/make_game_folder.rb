# =============================================================================
# make_game_folder.rb — Genera una carpeta de juego SINTETICA (sin datos ni
# graficos oficiales) para probar la capa de datos del juego y la legalidad.
#
#   GameFixture.build(dir, from: 'test_saves/Partida_2.rxdata')
#
# Los `.dat` se escriben con Marshal.dump de clases stub `GameData::*` con la
# forma de Essentials v21 (@id, @real_name, @types, @base_stats, @moves...).
# Los datos se DERIVAN del propio save: asi sus Pokemon son "legales" respecto a
# la carpeta (movimientos aprendibles, habilidades de su especie, stats que
# cuadran con la formula) y los tests pueden provocar ilegalidades concretas.
# Todo es inventado: nada de esto es contenido oficial.
# =============================================================================

require 'fileutils'

module GameFixture
  STATS = Sem::STAT_IDS

  # Movimiento que ninguna especie del fixture aprende (para provocar ilegales).
  UNLEARNABLE_MOVE = 'HYPERBEAM'
  EXTRA_ITEMS = %w[POTION POKEBALL GREATBALL MASTERBALL SUPERPOTION RARECANDY].freeze

  def self.define_classes
    return if defined?(::GameData::Species)

    mod = Object.const_defined?(:GameData) ? ::GameData : Object.const_set(:GameData, Module.new)
    %w[Species Move Item Ability Type].each { |n| mod.const_set(n, Class.new) unless mod.const_defined?(n) }
    Object.const_set(:RPG, Module.new) unless Object.const_defined?(:RPG)
    ::RPG.const_set(:System, Class.new) unless ::RPG.const_defined?(:System)
  end

  def self.obj(klass, **ivars)
    o = klass.allocate
    ivars.each { |k, v| o.instance_variable_set("@#{k}", v) }
    o
  end

  # Busca bases (B) tales que la formula reproduzca el stat guardado de TODOS los
  # miembros de la especie; si no hay solucion comun, usa la del primer miembro.
  def self.solve_base(members, stat)
    candidates = (1..255).select do |b|
      members.all? do |f|
        next true if f.stats[stat].nil? || f.iv[stat].nil? || f.ev[stat].nil? || f.level.nil?

        expected = if stat == 'HP'
                     Sem::GameData::Tables.calc_hp(b, f.level, f.iv[stat], f.ev[stat])
                   else
                     Sem::GameData::Tables.calc_stat(b, f.level, f.iv[stat], f.ev[stat],
                                                     Sem::GameData::Tables.nature_multiplier(f.nature_for_stats || f.nature, stat))
                   end
        expected == f.stats[stat]
      end
    end
    candidates.empty? ? 50 : candidates[candidates.size / 2]
  end

  def self.growth_rate_for(members)
    Sem::GameData::Tables::GROWTH_RATES.find do |rate|
      members.all? do |f|
        next true if f.exp.nil? || f.level.nil?

        f.exp >= Sem::GameData::Tables.exp_at(rate, f.level) && f.exp < Sem::GameData::Tables.exp_at(rate, f.level + 1)
      end
    end || 'Medium'
  end

  def self.gender_ratio_for(members)
    genders = members.map(&:gender).compact.uniq
    return 'Genderless' if genders == [2]
    return 'AlwaysMale' if genders == [0] && members.size > 1
    return 'AlwaysFemale' if genders == [1] && members.size > 1

    'Female50Percent'
  end

  # Lee los Pokemon del save con el propio driver (misma deteccion que la app).
  def self.facts_from(save_path)
    doc = RxDocument.parse(File.binread(save_path))
    state = Sem::State.detect(doc)
    [state, state.resolved.scan.pokemon.map { |ref| Sem::PokeFacts.read(ref.node) }]
  end

  def self.build(dir, from:, with_scripts: true, types_dat: true, names: {}, learnsets: true)
    define_classes
    state, facts = facts_from(from)
    model = state.model
    FileUtils.mkdir_p(File.join(dir, 'Data'))
    FileUtils.mkdir_p(File.join(dir, 'Graphics'))
    File.write(File.join(dir, 'Game.ini'), "[Game]\r\nTitle=Fixture Game\r\nScripts=Data\\Scripts.rxdata\r\n")

    by_species = facts.group_by(&:species)
    species = {}
    by_species.each do |sp, members|
      forms = members.map(&:form).uniq
      moves = members.flat_map { |f| f.moves.map { |m| m[:id] } }.compact.uniq
      abilities = members.map(&:ability).compact.uniq
      base_stats = STATS.to_h { |s| [s.to_sym, solve_base(members, s)] }
      ([0] + forms).uniq.each do |form|
        id = form.zero? ? sp : "#{sp}_#{form}"
        species[id.to_sym] = obj(::GameData::Species, id: id.to_sym, species: sp.to_sym, form: form,
                                 real_name: names[sp] || Sem::Ids.pretty(sp), real_form_name: (form.zero? ? nil : "Forma #{form}"),
                                 types: %i[NORMAL], base_stats: base_stats,
                                 growth_rate: growth_rate_for(members).to_sym,
                                 gender_ratio: gender_ratio_for(members).to_sym,
                                 moves: (learnsets ? moves.map { |m| [1, m.to_sym] } : []), tutor_moves: [], egg_moves: [],
                                 abilities: abilities.map(&:to_sym), hidden_abilities: %i[FIXTUREHIDDEN],
                                 evolutions: [], flags: [])
      end
    end

    # PP base de cada movimiento: el menor multiplo de 5 que explica el PP guardado con sus PP Ups.
    total_pp = Hash.new(5)
    facts.each do |f|
      f.moves.each do |m|
        next unless m[:id] && m[:pp]

        base = (m[:pp] * 5.0 / (5 + (m[:ppup] || 0))).ceil
        total_pp[m[:id]] = [total_pp[m[:id]], ((base + 4) / 5) * 5].max
      end
    end
    # Todo lo que el Pokedex del save menciona existe en el juego (con datos minimos).
    tmp = Session.new(doc: state.resolved.doc, file_path: from, output_path: from, page_size: 1)
    dex = Sem::Extras.new(tmp).pokedex
    (dex[:ids] || []).grep(String).each do |id|
      next if species.key?(id.to_sym)

      species[id.to_sym] = obj(::GameData::Species, id: id.to_sym, species: id.to_sym, form: 0, real_name: Sem::Ids.pretty(id),
                               types: %i[NORMAL], base_stats: STATS.to_h { |s| [s.to_sym, 50] }, growth_rate: :Medium,
                               gender_ratio: :Female50Percent, moves: [], tutor_moves: [], egg_moves: [], abilities: [],
                               hidden_abilities: [], evolutions: [], flags: [])
    end

    move_ids = (facts.flat_map { |f| f.moves.map { |m| m[:id] } }.compact + [UNLEARNABLE_MOVE, 'TACKLE', 'SURF']).uniq
    moves = move_ids.to_h do |id|
      [id.to_sym, obj(::GameData::Move, id: id.to_sym, real_name: Sem::Ids.pretty(id), type: :NORMAL, category: 0,
                      power: 40, accuracy: 100, total_pp: total_pp.key?(id) ? total_pp[id] : 25, flags: [])]
    end

    # El bolsillo de cada objeto sale de donde esta en la mochila del save.
    pocket_of = {}
    model.bag_view[:pockets].each { |pk| pk[:slots].each { |s| pocket_of[s[:id].to_s] ||= pk[:index] } }
    item_ids = (pocket_of.keys + facts.flat_map { |f| [f.item, f.ball] } + EXTRA_ITEMS).compact.map(&:to_s).uniq
    items = item_ids.to_h do |id|
      pocket = pocket_of[id] || (id.end_with?('BALL') ? 3 : 1)
      [id.to_sym, obj(::GameData::Item, id: id.to_sym, real_name: Sem::Ids.pretty(id), real_name_plural: "#{Sem::Ids.pretty(id)}s",
                      pocket: pocket, price: 100, field_use: 0, battle_use: 0, flags: [], move: nil)]
    end

    ability_ids = (facts.map(&:ability).compact + %w[FIXTUREHIDDEN]).map(&:to_s).uniq
    abilities = ability_ids.to_h do |id|
      [id.to_sym, obj(::GameData::Ability, id: id.to_sym, real_name: Sem::Ids.pretty(id), real_description: "Habilidad #{id}")]
    end

    write_dat(dir, 'species', species)
    write_dat(dir, 'moves', moves)
    write_dat(dir, 'items', items)
    write_dat(dir, 'abilities', abilities)
    write_dat(dir, 'types', { NORMAL: obj(::GameData::Type, id: :NORMAL, real_name: 'Normal') }) if types_dat
    write_system(dir)
    write_scripts(dir) if with_scripts
    dir
  end

  def self.write_dat(dir, name, hash)
    File.binwrite(File.join(dir, 'Data', "#{name}.dat"), Marshal.dump(hash))
  end

  def self.write_system(dir)
    sys = obj(::RPG::System, switches: [nil, 'Medalla 1', 'Tiene Pokédex', ''], variables: [nil, 'Pasos', 'Dinero ganado'],
                             game_title: 'Fixture Game')
    File.binwrite(File.join(dir, 'Data', 'System.rxdata'), Marshal.dump(sys))
  end

  def self.write_scripts(dir)
    FileUtils.mkdir_p(File.join(dir, 'Data', 'Scripts'))
    File.write(File.join(dir, 'Data', 'Scripts', '001_Settings.rb'), <<~RUBY)
      module Settings
        MAXIMUM_LEVEL = 100
        MAX_PARTY_SIZE = 6
        NUM_STORAGE_BOXES = 50
        MAX_MONEY = 999_999
        MAX_COINS = 99_999
        BAG_MAX_PER_SLOT = 999
        MAX_PLAYER_NAME_SIZE = 10 # comentario
        MAX_SOOT = SOMETHING_COMPUTED
      end
    RUBY
  end
end
