# =============================================================================
# context.rb — Lo que las reglas necesitan saber del juego y de la partida:
# limites, datos del juego vinculado y que dominios son FIABLES (calibracion).
#
# Una regla declara `needs`; si el contexto no puede satisfacerlo, la regla se
# OMITE (y se informa por que) en vez de dar falsos positivos.
# =============================================================================

module Sem
  module Legality
    # need -> motivo (el mismo codigo que usa GameData::Status para explicar la cobertura)
    NEED_REASONS = {
      species: 'no_species_data', moves_data: 'no_move_data', items: 'no_item_data',
      stats: 'stats_untrusted', exp: 'exp_untrusted', moves: 'moves_untrusted', abilities: 'abilities_untrusted',
      nickname_limit: 'limit_not_found', player_name_limit: 'limit_not_found'
    }.freeze

    class Context
      attr_reader :model, :game, :cal, :limits

      def initialize(model)
        @model = model
        @game = model.game
        @cal = model.calibration || {}
        @limits = model.limits
      end

      def cal_status(domain)
        @cal.dig(domain, :status)
      end

      # ¿Se puede aplicar una regla que necesita `need`?
      def can?(need)
        case need
        when :basic then true
        when :species then @game&.species? && cal_status(:species) != 'mismatch'
        when :moves_data then @game&.species? && @game.count(:moves).positive? && cal_status(:species) != 'mismatch'
        when :items then @game&.species? && @game.count(:items).positive? && cal_status(:species) != 'mismatch'
        when :stats then can?(:species) && cal_status(:stats) == 'ok'
        when :exp then can?(:species) && cal_status(:exp) == 'ok'
        when :moves then can?(:moves_data) && cal_status(:moves) != 'mismatch'
        # Los largos de nombre cambian mucho entre bases: solo se exigen si se leyeron de los scripts.
        when :nickname_limit then !!@game&.limit_overrides&.key?(:maxNickname)
        when :player_name_limit then !!@game&.limit_overrides&.key?(:maxPlayerName)
        when :abilities then can?(:species) && @game.count(:abilities).positive? && cal_status(:abilities) != 'mismatch'
        else false
        end ? true : false
      end

      # Motivo por el que `need` no se puede satisfacer.
      def reason_for(need)
        return 'no_game_folder' unless @game
        return 'species_mismatch' if cal_status(:species) == 'mismatch'

        NEED_REASONS[need] || "needs_#{need}"
      end
    end
  end
end
