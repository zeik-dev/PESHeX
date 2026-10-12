# =============================================================================
# profiles.rb — Perfiles de "base" de Essentials: DATOS declarativos (como se
# reconoce la base, donde suelen vivir los roles, que limites usa) mas una
# funcion de puntaje. No hay una clase por base: las variantes (@pockets/@bag,
# IDs int/sym, IV/EV array/hash) las absorben los codecs y el descubrimiento
# de roles por forma (detector.rb).
# =============================================================================

module Sem
  # Hechos baratos extraidos del save antes de puntuar perfiles.
  Facts = Struct.new(:root_form, :root_keys, :root_classes, :essentials_version, :game_version,
                     :species_style, :stat_style, :pokemon_count, keyword_init: true) do
    def version_number
      return nil unless essentials_version

      m = essentials_version.to_s.match(/\A(\d+)(?:\.(\d+))?/)
      m && "#{m[1]}.#{m[2] || 0}".to_f
    end
  end

  Profile = Struct.new(:id, :family, :label, :format, :ids, :stat_layout, :limits, :role_hints,
                       :world_root_keys, :world_classes, :scorer, keyword_init: true)

  VANILLA_LIMITS = {
    maxLevel: 100, maxMoney: 999_999, maxCoins: 99_999, maxBattlePoints: 9_999, maxSoot: 9_999,
    partySize: 6, ivMax: 31, evStatMax: 252, evTotalMax: 510, bagPerSlot: 999, ppMax: 99, happinessMax: 255,
    boxCount: 40, maxPlayerName: 10, maxNickname: 10, maxMoves: 4
  }.freeze

  # Claves/clases del motor que no son "contenido del jugador": se agrupan
  # como Mundo/Motor en la cobertura, no como "sin clasificar".
  ENGINE_ROOT_KEYS = %w[
    frame_count game_system pokemon_system switches variables self_switches game_screen map_factory
    game_player global_metadata map_metadata essentials_version game_version stats
  ].freeze
  ENGINE_CLASS_PATTERN = /\A(Game_|RPG::|Interpreter|PokemonMapFactory|PokemonSystem|PokemonGlobalMetadata|PokemonMapMetadata|PokemonTemp|GameStats|Phone|DayCare|SafariState|BugContestState|FollowerData|Table\z|Color\z|Tone\z|Time\z)/.freeze

  module Profiles
    module_function

    def all
      [SAVEDATA, LEGACY, GENERIC]
    end

    def fetch(id)
      all.find { |p| p.id == id }
    end

    # Puntaje 0..1 para Essentials v19+ (hash raiz de SaveData).
    SAVEDATA_SCORER = lambda do |facts, found_roles|
      score = 0.0
      ev = []
      if facts.root_form == :hash_root
        must = %w[player bag storage_system]
        present = must.count { |k| facts.root_keys.include?(k) }
        score += 0.30 * present / must.size
        ev << { code: 'root_hash', params: { present: present, total: must.size } } if present.positive?
      end
      ver = facts.version_number
      if ver && ver >= 19 && ver < 22
        score += 0.40
        ev << { code: 'version_match', params: { version: facts.essentials_version } }
      elsif ver && ver >= 22
        score += 0.30
        ev << { code: 'version_newer', params: { version: facts.essentials_version } }
      elsif ver.nil? && facts.root_form == :hash_root && facts.root_keys.include?('player')
        score += 0.15
        ev << { code: 'version_missing', params: {} }
      end
      expected = %w[Player PokemonBag PokemonStorage]
      hits = expected.count { |c| facts.root_classes.include?(c) }
      if hits.positive?
        score += 0.15 * hits / expected.size
        ev << { code: 'classes_match', params: { classes: expected.select { |c| facts.root_classes.include?(c) } } }
      end
      if facts.species_style == :symbol
        score += 0.075
        ev << { code: 'ids_symbol', params: {} }
      end
      if facts.stat_style == :hash
        score += 0.075
        ev << { code: 'stats_hash', params: {} }
      end
      score -= 0.2 if found_roles.size < 2
      [[score, 0.0].max, ev]
    end

    # Puntaje 0..1 para Essentials v16-v18 (varios Marshal.dump consecutivos).
    LEGACY_SCORER = lambda do |facts, found_roles|
      score = 0.0
      ev = []
      if facts.root_form == :multi_root
        score += 0.30
        ev << { code: 'root_multi', params: { roots: facts.root_classes.size } }
      end
      expected = [/Trainer/, /PokemonBag/, /PokemonStorage/]
      hits = expected.count { |re| facts.root_classes.any? { |c| c.to_s.match?(re) } }
      if hits.positive?
        score += 0.30 * hits / expected.size
        ev << { code: 'classes_match', params: { classes: facts.root_classes.compact.uniq.first(6) } }
      end
      if facts.species_style == :integer
        score += 0.15
        ev << { code: 'ids_integer', params: {} }
      end
      if facts.stat_style == :array
        score += 0.15
        ev << { code: 'stats_array', params: {} }
      end
      if facts.essentials_version.nil? && facts.root_form == :multi_root
        score += 0.10
        ev << { code: 'version_missing', params: {} }
      end
      score -= 0.2 if found_roles.size < 2
      [[score, 0.0].max, ev]
    end

    GENERIC_SCORER = lambda do |_facts, found_roles|
      score = 0.20 + 0.10 * [found_roles.size, 3].min
      [score, [{ code: 'shape_only', params: { roles: found_roles.size } }]]
    end

    SAVEDATA = Profile.new(
      id: 'essentials_savedata', family: 'essentials', label: 'Pokémon Essentials v19–v21',
      format: :hash_root, ids: :symbol, stat_layout: :hash, limits: VANILLA_LIMITS,
      role_hints: {
        trainer: { root_key: 'player' }, bag: { root_key: 'bag' }, storage: { root_key: 'storage_system' },
        stats: { root_key: 'stats' }, global: { root_key: 'global_metadata' }
      },
      world_root_keys: ENGINE_ROOT_KEYS, world_classes: ENGINE_CLASS_PATTERN, scorer: SAVEDATA_SCORER
    ).freeze

    LEGACY = Profile.new(
      id: 'essentials_legacy', family: 'essentials', label: 'Pokémon Essentials v16–v18',
      format: :multi_root, ids: :integer, stat_layout: :array, limits: VANILLA_LIMITS,
      role_hints: {
        trainer: { root_class: /Trainer/ }, bag: { root_class: /PokemonBag/ },
        storage: { root_class: /PokemonStorage/ }, global: { root_class: /PokemonGlobal/ }
      },
      world_root_keys: [], world_classes: ENGINE_CLASS_PATTERN, scorer: LEGACY_SCORER
    ).freeze

    GENERIC = Profile.new(
      id: 'generic', family: 'generic', label: 'Base desconocida (detección por forma)',
      format: :any, ids: :any, stat_layout: :any, limits: VANILLA_LIMITS,
      role_hints: {}, world_root_keys: ENGINE_ROOT_KEYS, world_classes: ENGINE_CLASS_PATTERN,
      scorer: GENERIC_SCORER
    ).freeze
  end
end
