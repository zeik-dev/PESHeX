# =============================================================================
# derived.rb — Datos que las bases <= v18 (Essentials v16-18) NO guardan en el Pokémon y el motor calcula
# al vuelo (verificado en los scripts de Pokémon Z):
#
#   nivel      PBExperience.pbGetLevelFromExperience(@exp, tasa de crecimiento)
#   habilidad  @abilityflag (INDICE 0..5, no un id) || (@personalID & 1); la especie lista 2 normales + ocultas
#   naturaleza @natureflag || (@personalID % 25)
#   genero     @genderflag || segun el ratio de la especie y el byte bajo de @personalID
#   bola       @ballused = INDICE de `$BallTypes` (0=>POKEBALL, 1=>GREATBALL ...), no un id de objeto
#
# Solo se calculan con la carpeta del juego vinculada (las tablas salen del PBS/scripts del juego) y solo
# cuando el Pokémon es de ese estilo (sin @level / @ability / @nature / @poke_ball propios).
# =============================================================================

module Sem
  module Derived
    module_function

    VANILLA_BALLS = %w[POKEBALL GREATBALL SAFARIBALL ULTRABALL MASTERBALL NETBALL DIVEBALL NESTBALL REPEATBALL
                       TIMERBALL LUXURYBALL PREMIERBALL DUSKBALL HEALBALL QUICKBALL CHERISHBALL].freeze

    def first(obj, names)
      Tree.first_ivar(obj, names)&.last&.last
    end

    # ¿Pokémon de estilo v16-18? (clase PokeBattle_Pokemon o sus ivars propios: @abilityflag/@natureflag/@ballused)
    def legacy?(pk)
      return true if Tree.class_name(pk).to_s == 'PokeBattle_Pokemon'

      !Tree.ivar(pk, '@ballused').nil? && Tree.ivar(pk, '@poke_ball').nil?
    end

    def species_form(pk)
      [Ids.of(first(pk, %w[@species])), Tree.int_value(first(pk, %w[@form])) || 0]
    end

    def personal_id(pk)
      Tree.int_value(first(pk, %w[@personalID @personal_id]))
    end

    # Nivel por experiencia (nil si el juego no conoce la especie).
    def level(game, pk)
      return nil unless game&.species?

      exp = Tree.int_value(first(pk, %w[@exp @experience]))
      id, form = species_form(pk)
      return nil if exp.nil? || id.nil? || game.species_entry(id, form).nil?

      GameData::Tables.level_for_exp(game.growth_rate(id, form), exp, game.limits[:maxLevel])
    end

    # Id de naturaleza ('ADAMANT') de un Pokémon v16-18.
    def nature_id(pk)
      flag = Tree.int_value(first(pk, %w[@natureflag]))
      pid = personal_id(pk)
      idx = flag || (pid && pid % 25)
      idx && GameData::Tables::NATURE_IDS[idx]
    end

    # Indice de habilidad (0..5) de un Pokémon v16-18.
    def ability_index(pk)
      flag = Tree.int_value(first(pk, %w[@abilityflag]))
      return flag if flag

      pid = personal_id(pk)
      pid && (pid & 1)
    end

    # Casillas de habilidad de la especie como las lee el motor: [normal0, normal1, oculta0 .. oculta3] (nil = vacia).
    def ability_slots(game, id, form)
      sp = game.species_entry(id, form)
      return [] unless sp

      base = game.base_species(sp.species) || sp
      normal = sp.abilities.empty? ? base.abilities : sp.abilities
      hidden = sp.hidden_abilities.empty? ? base.hidden_abilities : sp.hidden_abilities
      [normal[0], normal[1], hidden[0], hidden[1], hidden[2], hidden[3]]
    end

    # Habilidad efectiva de un Pokémon v16-18, con la misma regla que `PokeBattle_Pokemon#ability`.
    def ability(game, pk)
      return nil unless game&.species?

      id, form = species_form(pk)
      slots = ability_slots(game, id, form)
      return nil if slots.compact.empty?

      idx = ability_index(pk)
      return nil if idx.nil?
      return slots[idx] if idx < slots.size && slots[idx]

      idx = (personal_id(pk) || 0) & 1 if idx >= 2
      (idx == 1 && slots[1]) || slots[0]
    end

    # Indice de casilla donde esta `name` para la especie (para escribir @abilityflag), o nil.
    def ability_slot_of(game, pk, name)
      id, form = species_form(pk)
      ability_slots(game, id, form).index(name.to_s)
    end

    # 0 macho, 1 hembra, 2 sin genero.
    def gender(game, pk)
      flag = Tree.int_value(first(pk, %w[@genderflag @gender]))
      return flag if flag
      return nil unless game&.species?

      id, form = species_form(pk)
      info = GameData::Tables::GENDER_RATIOS[game.gender_ratio(id, form).to_s]
      pid = personal_id(pk)
      return nil if info.nil? || pid.nil?
      return info[:only] if info.key?(:only)

      (pid & 0xFF) < info[:female] ? 1 : 0
    end

    # Objeto (id del PBS) de la bola de un Pokémon: v19+ ya es el símbolo del objeto; v16-18 es un indice.
    def ball_item(game, value)
      return value unless value.is_a?(Integer)

      table = game&.ball_types || VANILLA_BALLS.each_with_index.to_h { |b, i| [i, b] }
      table[value]
    end

    # Indice de `$BallTypes` de un objeto-bola (para escribir @ballused).
    def ball_index_of(game, item)
      table = game&.ball_types || VANILLA_BALLS.each_with_index.to_h { |b, i| [i, b] }
      table.key(item.to_s)
    end
  end
end
