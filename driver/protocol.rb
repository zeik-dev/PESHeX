# =============================================================================
# protocol.rb — Errores y helpers del protocolo JSON por linea del driver.
#
# Peticion:  {"id":N,"cmd":"...", ...params}
# Respuesta: {"id":N,"ok":true,"revision":R,...} o
#            {"id":N,"ok":false,"error":{"type":"...","message":"...","params":{...}}}
#
# Las vistas semanticas nuevas devuelven CODIGOS + params (la UI los traduce);
# `message` queda como texto de respaldo para depuracion y para el modo Avanzado.
# =============================================================================

require 'json'

class DriverError < StandardError
  attr_reader :error_type, :params

  def initialize(error_type, message, params = nil)
    super(message)
    @error_type = error_type
    @params = params
  end
end

module Protocol
  # Claves de la respuesta que pertenecen al protocolo: un comando no puede devolverlas (ver `ok_response`).
  RESERVED_KEYS = %w[id ok].freeze

  module_function

  def write_json(obj)
    $stdout.write(JSON.generate(obj))
    $stdout.write("\n")
  end

  # `id` y `ok` mandan sobre lo que devuelva el comando: el `id` de la respuesta debe ser siempre el de la peticion (el
  # cliente lo usa para detectar un stream desincronizado y, si no coincide, da de baja la sesion entera).
  def ok_response(id, data = {}, revision: nil)
    body = { id: id, ok: true }
    body[:revision] = revision unless revision.nil?
    payload = data.reject { |k, _| RESERVED_KEYS.include?(k.to_s) }
    write_json(body.merge(payload))
  end

  def err_response(id, type, message, params = nil)
    error = { type: type, message: message }
    error[:params] = params if params
    write_json({ id: id, ok: false, error: error })
  end
end
