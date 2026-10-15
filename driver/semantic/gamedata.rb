# =============================================================================
# gamedata.rb — Datos del juego vinculado (carpeta del fangame): nombres reales,
# especies/movimientos/objetos, limites de Settings y calibracion contra el save.
# =============================================================================

module Sem
  module GameData; end
end

%w[tables locator dat_reader entries pbs settings_scan system_data map_infos store cache calibration catalog status].each do |f|
  require_relative "gamedata/#{f}"
end
