# =============================================================================
# catalog.rb — Catalogo de entidades del juego para los selectores de la UI
# (especies, movimientos, objetos, habilidades, tipos, naturalezas). La busqueda
# difusa se hace en el cliente; aqui solo se serializa, con claves cortas y sin
# datos pesados (las listas de movimientos por especie se piden con get_species).
# =============================================================================

module Sem
  module GameData
    module Catalog
      KINDS = %w[species moves items abilities types natures].freeze

      module_function

      def build(store, kinds = nil)
        wanted = kinds.nil? || kinds.empty? ? KINDS : (KINDS & kinds.map(&:to_s))
        wanted.to_h { |k| [k.to_sym, public_send("#{k}_list", store)] }
      end

      def species_list(store)
        store.table(:species).values.map do |s|
          { id: s.id, species: s.species, form: s.form, name: s.name, formName: s.form_name, types: s.types,
            number: s.number }
        end
      end

      def moves_list(store)
        store.table(:moves).values.map do |m|
          { id: m.id, name: m.name, type: m.type, category: m.category, power: m.power, accuracy: m.accuracy,
            pp: m.total_pp }
        end
      end

      def items_list(store)
        store.table(:items).values.map do |i|
          { id: i.id, name: i.name, pocket: i.pocket, machine: i.machine?, move: i.move }
        end
      end

      def abilities_list(store)
        store.table(:abilities).values.map { |a| { id: a.id, name: a.name, description: a.description } }
      end

      def types_list(store)
        store.types.map { |t| { id: t.id, name: t.name } }
      end

      def natures_list(_store)
        Tables::NATURES.map { |id, up, down| { id: id, up: up, down: down } }
      end

      # Ficha completa de una especie (para el editor de Pokemon).
      def species_detail(store, id, form)
        e = store.species_entry(id, form)
        return nil unless e

        base = store.base_species(id) || e
        { id: e.id, species: e.species, form: e.form, name: base.name, formName: e.form_name, types: e.types,
          baseStats: store.base_stats(id, form), growthRate: store.growth_rate(id, form),
          genderRatio: store.gender_ratio(id, form), abilities: e.abilities.empty? ? base.abilities : e.abilities,
          hiddenAbilities: e.hidden_abilities.empty? ? base.hidden_abilities : e.hidden_abilities,
          levelMoves: e.moves.empty? ? base.moves : e.moves,
          tutorMoves: (e.tutor_moves + base.tutor_moves).uniq, eggMoves: (e.egg_moves + base.egg_moves).uniq,
          evolutions: base.evolutions, prevos: store.prevos(id), minimumLevel: store.minimum_level(id) }
      end
    end
  end
end
