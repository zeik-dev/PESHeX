# =============================================================================
# session.rb — Estado de un archivo abierto.
#
# Abrir un save ya NO construye el Collector (aplana los ~320k campos: ~6 s en
# un save de 9 MB). El indice de campos se crea bajo demanda (`ensure_index!`):
# solo lo necesitan la vista Avanzado, la lista de campos y el reporte de nil.
# Las vistas semanticas leen directamente el arbol de nodos de `doc`.
# =============================================================================

class Session
  attr_accessor :doc, :file_path, :output_path, :page_size,
                :revision, :script_paths, :semantic, :game, :game_calibration, :mode,
                :legality_baseline
  attr_reader :journal

  def initialize(doc:, file_path:, output_path:, page_size:, script_paths: [])
    @doc = doc
    @file_path = file_path
    @output_path = output_path
    @page_size = page_size
    @roundtrip_diff = nil
    @roundtrip_checked = false
    @script_paths = script_paths
    @journal = Sem::Journal.new
    @revision = 0
    @collector = nil
    @oracle = nil
    @scripts = nil
    @script_report = nil
    @semantic = nil
    @game = nil # Sem::GameData::Store de la carpeta vinculada (o nil)
    @game_calibration = nil
    @mode = Sem::Legality::DEFAULT_MODE # 'hex' | 'hax'
    @legality_baseline = nil
    @baseline_taken = false
  end

  # Verifica (una sola vez) que el documento se reconstruye byte a byte. Debe
  # ejecutarse ANTES de la primera mutacion, porque compara contra los bytes
  # originales; por eso es perezoso (cuesta ~1 s en un save de 9 MB) y el
  # registro de comandos lo fuerza antes de cualquier comando que modifique.
  def roundtrip_diff
    unless @roundtrip_checked
      @roundtrip_diff = @doc.roundtrip_diff
      @roundtrip_checked = true
    end
    @roundtrip_diff
  end

  def roundtrip_checked?
    @roundtrip_checked
  end

  # Flags de legalidad que el save ya traia, tomadas ANTES de la primera mutacion: en HeX solo lo
  # que se anade despues cuenta como ilegalidad nueva (p. ej. al guardar). Si algo falla, no hay
  # linea base y HeX solo comprueba cada edicion por separado.
  def ensure_legality_baseline!
    return if @baseline_taken

    @baseline_taken = true
    @legality_baseline = Sem::Legality::Engine.new(self).snapshot_all
  rescue StandardError => e
    @legality_baseline = nil
    warn "legality baseline: #{e.class}: #{e.message}" if ENV['RXDATA_DRIVER_DEBUG']
  end

  def reset_legality_baseline!
    @baseline_taken = false
    @legality_baseline = nil
  end

  # Sube la revision tras cualquier mutacion; la UI usa `revision` como parte
  # de la clave de cache de sus consultas.
  def bump_revision!
    @revision += 1
  end

  # ¿Hay cambios sin guardar?
  def dirty?
    @journal.dirty?
  end

  def index_ready?
    !@collector.nil?
  end

  # Construye (una sola vez) ScriptIndex + Collector + TypeOracle.
  def ensure_index!
    return self if index_ready?

    unless @script_paths.empty?
      @scripts = ScriptIndex.new
      @script_paths.each { |p| @scripts.add_path(p) }
      @script_report = { filesScanned: @scripts.files, hints: @scripts.hint_total,
                         fallbackFiles: @scripts.fallback_files, rootsUsed: @scripts.roots_used,
                         errors: @scripts.errors.first(5) }
    end
    @collector = Collector.new(@doc).run
    @oracle = TypeOracle.new(@collector, @scripts)
    self
  end

  def collector
    ensure_index!
    @collector
  end

  def oracle
    ensure_index!
    @oracle
  end

  def scripts
    ensure_index!
    @scripts
  end

  def script_report
    @script_report || { filesScanned: 0, hints: 0, fallbackFiles: 0, rootsUsed: [], errors: [] }
  end

  # Espeja el rebuild que hace el REPL tras una edicion estructural
  # ([]/{}/copiar): insertar o reemplazar un array/objeto cambia la cantidad
  # e identidad de todos los campos hijo. Si el indice nunca se construyo no
  # hay nada que reconstruir.
  def rebuild_collector!
    return unless index_ready?

    @collector = Collector.new(@doc).run
    @oracle.reset!(@collector)
  end

  def index_counts
    return { state: 'idle', fieldCount: nil, nilCount: nil } unless index_ready?

    { state: 'ready', fieldCount: @collector.fields.size,
      nilCount: @collector.fields.count { |f| f.get.nil? } }
  end
end
