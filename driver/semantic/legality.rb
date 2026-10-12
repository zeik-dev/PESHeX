# =============================================================================
# legality.rb — Modos HeX / HaX y legalidad. Carga ordenada de legality/*.
#
#   HeX  no deja INTRODUCIR ilegalidades segun las reglas del juego vinculado
#   HaX  permite cualquier edicion y solo muestra las flags
# =============================================================================

module Sem
  module Legality
    MODES = %w[hex hax].freeze
    DEFAULT_MODE = 'hex'
  end
end

%w[flags context rules_pokemon rules_misc engine guard].each { |f| require_relative "legality/#{f}" }
