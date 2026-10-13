# =============================================================================
# transfer.rb — Exportar un Pokemon a JSON semantico (esquema peshex.pokemon/1) o
# a texto estilo Pokemon Showdown. La importacion es la op `pokemon.add` (con esos
# mismos campos); el texto de Showdown se interpreta en la UI.
# =============================================================================

module Sem
  module Transfer
    SCHEMA = 'peshex.pokemon/1'
    SHOWDOWN_STATS = { 'HP' => 'HP', 'ATTACK' => 'Atk', 'DEFENSE' => 'Def', 'SPECIAL_ATTACK' => 'SpA',
                       'SPECIAL_DEFENSE' => 'SpD', 'SPEED' => 'Spe' }.freeze

    module_function

    def export_hash(model, session, pk)
      f = PokeFacts.read(pk, session.game)
      owner = model.owner_dto(pk)
      {
        schema: SCHEMA, base: model.resolved.profile.id, species: f.species, form: f.form, nickname: f.nickname,
        level: f.level, exp: f.exp, nature: f.nature, natureForStats: f.nature_for_stats, ability: f.ability,
        abilityIndex: f.ability_index, item: f.item, ball: f.ball, gender: f.gender, shiny: f.shiny, happiness: f.happiness,
        hp: f.hp, iv: f.iv, ev: f.ev, moves: f.moves.map { |m| { id: m[:id], pp: m[:pp], ppUps: m[:ppup] } }, owner: owner,
        personalId: f.personal_id, game: session.game&.info&.dig(:title)
      }
    end

    def name_of(model, kind, id)
      id && model.name_of(kind, id)
    end

    def showdown(model, pk)
      f = PokeFacts.read(pk, model.game)
      species = name_of(model, :species, f.species) || f.species.to_s
      head = f.nickname && f.nickname != species ? "#{f.nickname} (#{species})" : species
      head += { 0 => ' (M)', 1 => ' (F)' }.fetch(f.gender, '')
      item = f.item && f.item != 0 ? name_of(model, :item, f.item) : nil
      head += " @ #{item}" if item
      lines = [head]
      lines << "Ability: #{name_of(model, :ability, f.ability) || f.ability}" if f.ability
      lines << "Level: #{f.level}" if f.level
      lines << 'Shiny: Yes' if f.shiny
      lines << "Happiness: #{f.happiness}" if f.happiness && f.happiness != 255
      evs = f.ev.filter_map { |s, v| "#{v} #{SHOWDOWN_STATS[s]}" if v&.positive? }
      lines << "EVs: #{evs.join(' / ')}" unless evs.empty?
      lines << "#{Ids.pretty(f.nature.to_s)} Nature" if f.nature
      ivs = f.iv.filter_map { |s, v| "#{v} #{SHOWDOWN_STATS[s]}" if v && v != 31 }
      lines << "IVs: #{ivs.join(' / ')}" unless ivs.empty?
      f.moves.each { |m| lines << "- #{name_of(model, :move, m[:id]) || m[:id]}" }
      lines.join("\n")
    end
  end
end
