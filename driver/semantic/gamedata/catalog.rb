# =============================================================================
# catalog.rb — Catalogo de entidades del juego para los selectores de la UI
# (especies, movimientos, objetos, habilidades, tipos, naturalezas). La busqueda
# difusa se hace en el cliente; aqui solo se serializa, con claves cortas y sin
# datos pesados (las listas de movimientos por especie se piden con get_species).
# =============================================================================

module Sem
  module GameData
    module Catalog
      KINDS = %w[species moves items abilities types natures ribbons].freeze

      module_function

      def build(store, kinds = nil)
        wanted = kinds.nil? || kinds.empty? ? KINDS : (KINDS & kinds.map(&:to_s))
        wanted.to_h { |k| [k.to_sym, public_send("#{k}_list", store)] }
      end

      def species_list(store)
        store.table(:species).values.map do |s|
          { id: s.id, species: s.species, form: s.form, name: s.name, formName: s.form_name, types: s.types,
            number: s.number, order: s.order }
        end
      end

      def moves_list(store)
        store.table(:moves).values.map do |m|
          { id: m.id, number: m.number, name: m.name, type: m.type, category: m.category, power: m.power,
            accuracy: m.accuracy, pp: m.total_pp }
        end
      end

      def items_list(store)
        store.table(:items).values.map do |i|
          { id: i.id, number: i.number, name: i.name, pocket: i.pocket, machine: i.machine?, move: i.move,
            fieldUse: i.field_use }
        end
      end

      def abilities_list(store)
        store.table(:abilities).values.map { |a| { id: a.id, number: a.number, name: a.name, description: a.description } }
      end

      def types_list(store)
        store.types.map do |t|
          { id: t.id, name: t.name, weaknesses: t.weaknesses, resistances: t.resistances, immunities: t.immunities,
            special: t.special == true }
        end
      end

      def ribbons_list(store)
        store.ribbons.map { |r| { id: r.id, name: r.name, description: r.description, icon: r.icon } }
      end

      def natures_list(_store)
        Tables::NATURES.map { |id, up, down| { id: id, up: up, down: down } }
      end

      INFO_FIELDS = { category: :category, pokedex: :pokedex, height: :height, weight: :weight, color: :color,
                      shape: :shape, habitat: :habitat, generation: :generation, catchRate: :catch_rate,
                      happiness: :happiness, evYield: :ev_yield, eggGroups: :egg_groups, hatchSteps: :hatch_steps,
                      baseExp: :base_exp, wildItems: :wild_items, formNames: :form_names }.freeze

      def blank?(v)
        v.nil? || (v.respond_to?(:empty?) && v.empty?)
      end

      # Ficha completa de una especie (para el editor de Pokemon y la Pokedex): stats, habilidades, movimientos
      # (nivel / tutor / huevo / MT), evoluciones, datos de Pokedex y formas. Una forma hereda de la especie base.
      def species_detail(store, id, form)
        e = store.species_entry(id, form)
        return nil unless e

        base = store.base_species(e.species) || e
        pick = ->(f) { blank?(e[f]) ? base[f] : e[f] }
        info = INFO_FIELDS.to_h { |key, f| [key, pick.call(f)] }.reject { |_, v| blank?(v) }
        profile = store.learn_profile(e.species, e.form)
        { id: e.id, species: e.species, form: e.form, number: base.number, order: base.order, name: base.name,
          formName: e.form_name, types: e.types.empty? ? base.types : e.types,
          baseStats: store.base_stats(e.id, form), growthRate: store.growth_rate(e.id, form),
          genderRatio: store.gender_ratio(e.id, form), abilities: pick.call(:abilities),
          hiddenAbilities: pick.call(:hidden_abilities), levelMoves: pick.call(:moves),
          tutorMoves: (e.tutor_moves + base.tutor_moves).uniq, eggMoves: (e.egg_moves + base.egg_moves).uniq,
          tmMoves: (e.tm_moves + base.tm_moves).uniq, evolutions: base.evolutions, prevos: store.prevos(e.species),
          minimumLevel: store.minimum_level(e.species), info: info, mega: e.mega, region: e.region,
          # Todo lo que la especie (y sus preevoluciones) puede aprender, a cualquier nivel: nivel, tutor, MT y huevo.
          learnable: (profile.min_level.keys + profile.always.to_a).uniq,
          forms: forms_of(store, base) }
      end

      # Formas alternativas (Mega, regionales...) de una especie base.
      def forms_of(store, base)
        store.table(:species).values.select { |s| s.species == base.id && s.form.positive? }.map do |s|
          { id: s.id, form: s.form, formName: s.form_name, types: s.types, baseStats: s.base_stats, mega: s.mega,
            region: s.region }
        end
      end
    end
  end
end
