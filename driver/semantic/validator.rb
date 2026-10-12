# =============================================================================
# validator.rb — Reglas de consistencia con severidad. Los LIMITES son blandos
# (vienen del perfil, por defecto los de Essentials vanilla): una base custom
# puede cambiarlos, asi que un valor fuera de rango es un `error` que pide
# confirmacion explicita, no una prohibicion.
#
#   error    bloquea el guardado/la edicion salvo `confirmed: true`
#   warning  se informa, no bloquea
#   info     nota para el usuario
#
# Los textos NO viven aqui: cada issue lleva `code` + `params` y la UI traduce.
# =============================================================================

module Sem
  module Validator
    module_function

    def issue(severity, code, params = {}, ref = nil)
      h = { severity: severity.to_s, code: code, params: params }
      h[:ref] = ref if ref
      h
    end

    def range(field, value, min, max, ref)
      return nil if value.nil?
      return nil if value >= min && (max.nil? || value <= max)

      issue(:error, 'value_range', { field: field, value: value, min: min, max: max }, ref)
    end

    def trainer_issues(model, ref = 'trainer')
      lim = model.limits
      out = []
      {
        'money' => lim[:maxMoney], 'coins' => lim[:maxCoins],
        'battle_points' => lim[:maxBattlePoints], 'soot' => lim[:maxSoot]
      }.each do |field, max|
        out << range(field, Tree.int_value(model.trainer_value(field)), 0, max, ref)
      end
      out.compact
    end

    def pokemon_issues(model, ref)
      dto = model.pokemon_detail(ref)
      return [] unless dto

      lim = model.limits
      out = []
      out << range('level', dto[:level], 1, lim[:maxLevel], ref)
      dto[:iv].each { |stat, v| out << range("iv.#{stat}", v, 0, lim[:ivMax], ref) }
      dto[:ev].each { |stat, v| out << range("ev.#{stat}", v, 0, lim[:evStatMax], ref) }
      if dto[:evTotal] > lim[:evTotalMax]
        out << issue(:warning, 'ev_total_over', { total: dto[:evTotal], max: lim[:evTotalMax] }, ref)
      end
      out << range('happiness', dto[:happiness], 0, lim[:happinessMax], ref)
      if dto[:hp] && dto[:totalHp] && dto[:hp] > dto[:totalHp]
        out << issue(:warning, 'hp_over_total', { hp: dto[:hp], totalHp: dto[:totalHp] }, ref)
      end
      ids = dto[:moves].map { |m| m[:id] }
      dup = ids.group_by(&:itself).select { |_, v| v.size > 1 }.keys
      out << issue(:warning, 'moves_duplicate', { moves: dup }, ref) unless dup.empty?
      out << issue(:error, 'moves_count', { count: ids.size, max: 4 }, ref) if ids.size > 4
      out << issue(:error, 'moves_count', { count: 0, max: 4 }, ref) if ids.empty?
      dto[:moves].each do |m|
        next unless m[:pp] && m[:pp] > lim[:ppMax]

        out << issue(:warning, 'pp_over_max', { move: m[:id], pp: m[:pp], max: lim[:ppMax] }, ref)
      end
      out.compact
    end

    def bag_issues(model, ref = 'bag')
      bag = model.bag_view
      return [] unless bag

      max = model.limits[:bagPerSlot]
      out = []
      bag[:pockets].each do |pocket|
        pocket[:slots].each do |s|
          next if s[:qty].nil?
          next if s[:qty].between?(1, max)

          out << issue(:error, 'qty_range', { item: s[:id], qty: s[:qty], max: max }, ref)
        end
      end
      out
    end

    # Issues de las entidades indicadas por `refs` (trainer, bag, party/N, box/B/S).
    def validate_refs(model, refs)
      refs.flat_map do |ref|
        kind = ref.to_s.split('/').first
        case kind
        when 'trainer' then trainer_issues(model, ref)
        when 'bag' then bag_issues(model, ref)
        when 'party', 'box' then pokemon_issues(model, ref)
        else []
        end
      end
    end

    def validate_all(model)
      refs = ['trainer', 'bag']
      refs += model.party_items.each_index.select { |i| model.party_items[i] }.map { |i| "party/#{i}" }
      validate_refs(model, refs)
    end

    def blocking(issues)
      issues.select { |i| i[:severity] == 'error' }
    end
  end
end
