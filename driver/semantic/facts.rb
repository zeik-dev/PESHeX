# =============================================================================
# facts.rb — "Hechos" planos de un Pokemon leidos del nodo, independientes de la
# version de la base (@species/@form, IV/EV como hash o array, @poke_ball/@ballused...).
# Los usan la calibracion, la legalidad, el recalculo de stats y la exportacion,
# asi ninguno repite la lectura de ivars.
# =============================================================================

module Sem
  PokemonFacts = Struct.new(
    :node, :species, :form, :level, :exp, :nature, :nature_for_stats, :ability, :ability_index, :gender,
    :item, :ball, :moves, :iv, :ev, :happiness, :hp, :stats, :nickname, :owner_name, :status, :egg,
    :personal_id, :shiny, :cannot_store, :pp_ups_total, keyword_init: true
  )

  module PokeFacts
    module_function

    def first(obj, names)
      Tree.first_ivar(obj, names)&.last&.last
    end

    def read(pk)
      sp = Ids.of(first(pk, %w[@species]))
      steps = Tree.int_value(first(pk, %w[@steps_to_hatch @eggsteps]))
      owner = first(pk, %w[@owner])
      owner_name = Tree.object?(owner) ? Tree.text(Tree.ivar(owner, '@name')) : Tree.text(first(pk, %w[@ot]))
      PokemonFacts.new(
        node: pk, species: sp, form: Tree.int_value(first(pk, %w[@form])) || 0,
        level: Tree.int_value(first(pk, %w[@level])), exp: Tree.int_value(first(pk, %w[@exp @experience])),
        nature: Ids.of(first(pk, %w[@nature @natureflag])),
        nature_for_stats: Ids.of(first(pk, %w[@nature_for_stats])),
        ability: Ids.of(first(pk, %w[@ability @abilityflag])),
        ability_index: Tree.int_value(first(pk, %w[@ability_index @abilityIndex])),
        gender: Tree.int_value(first(pk, %w[@gender @genderflag])),
        item: Ids.of(first(pk, %w[@item])), ball: Ids.of(first(pk, %w[@poke_ball @ballused])),
        moves: moves(pk), iv: StatMap.read(Tree.ivar(pk, '@iv')), ev: StatMap.read(Tree.ivar(pk, '@ev')),
        happiness: Tree.int_value(first(pk, %w[@happiness])), hp: Tree.int_value(first(pk, %w[@hp])),
        stats: {
          'HP' => Tree.int_value(first(pk, %w[@totalhp])), 'ATTACK' => Tree.int_value(first(pk, %w[@attack])),
          'DEFENSE' => Tree.int_value(first(pk, %w[@defense])), 'SPECIAL_ATTACK' => Tree.int_value(first(pk, %w[@spatk])),
          'SPECIAL_DEFENSE' => Tree.int_value(first(pk, %w[@spdef])), 'SPEED' => Tree.int_value(first(pk, %w[@speed]))
        },
        nickname: Tree.text(first(pk, %w[@name @nickname])), owner_name: owner_name,
        status: Ids.of(first(pk, %w[@status])), egg: !steps.nil? && steps.positive?,
        personal_id: Tree.int_value(first(pk, %w[@personalID @personal_id])),
        shiny: first(pk, %w[@shiny @shinyflag]) == true,
        cannot_store: !first(pk, %w[@cannot_store]).nil? && first(pk, %w[@cannot_store]) != false
      )
    end

    def moves(pk)
      arr = Tree.ivar(pk, '@moves')
      return [] unless Tree.array?(arr)

      arr.items.filter_map do |m|
        next nil unless m

        id_node = Tree.object?(m) ? Tree.ivar(m, '@id') : m
        { id: Ids.of(id_node), pp: Tree.int_value(Tree.object?(m) ? Tree.ivar(m, '@pp') : nil),
          ppup: Tree.int_value(Tree.object?(m) ? first(m, %w[@ppup @ppUp]) : nil) }
      end
    end
  end
end
