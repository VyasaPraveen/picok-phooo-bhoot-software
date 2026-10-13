using System.Text.Json.Nodes;

namespace Epixs.PrintBridge.Cloud;

/// <summary>
/// In-memory copy of one streamed collection (e.g. /booths/{b}/jobs), kept current from put/patch events.
/// Thread-safe; readers get deep copies.
/// </summary>
public sealed class RtdbMirror
{
    private readonly object _gate = new();
    private JsonObject _root = new();
    private volatile bool _loaded;

    /// <summary>True once the stream delivered the whole node (its first put at "/").</summary>
    public bool Loaded => _loaded;

    /// <summary>Applies a stream event and returns the top-level child keys it touched.</summary>
    public IReadOnlyCollection<string> Apply(RtdbEvent e)
    {
        lock (_gate)
        {
            var segments = e.Path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (e.Name == "patch")
            {
                var touched = new HashSet<string>(StringComparer.Ordinal);
                if (e.Data is JsonObject patch)
                {
                    foreach (var (key, value) in patch.ToList())
                        touched.UnionWith(Put([.. segments, .. key.Split('/', StringSplitOptions.RemoveEmptyEntries)], value?.DeepClone()));
                }
                return touched;
            }
            var result = Put(segments, e.Data?.DeepClone());
            if (segments.Length == 0)
                _loaded = true;
            return result;
        }
    }

    public JsonObject? Get(string key)
    {
        lock (_gate)
            return _root[key] is JsonObject child ? (JsonObject)child.DeepClone() : null;
    }

    public bool Contains(string key)
    {
        lock (_gate)
            return _root[key] is JsonObject;
    }

    /// <summary>Deep copy of the whole streamed node.</summary>
    public JsonObject Snapshot()
    {
        lock (_gate)
            return (JsonObject)_root.DeepClone();
    }

    public IReadOnlyList<string> Keys()
    {
        lock (_gate)
            return _root.Select(kv => kv.Key).ToList();
    }

    private HashSet<string> Put(string[] segments, JsonNode? value)
    {
        if (segments.Length == 0)
        {
            var touched = new HashSet<string>(_root.Select(kv => kv.Key), StringComparer.Ordinal);
            _root = value as JsonObject ?? new JsonObject();
            touched.UnionWith(_root.Select(kv => kv.Key));
            return touched;
        }

        var parents = new List<JsonObject> { _root };
        var node = _root;
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (node[segments[i]] is not JsonObject next)
            {
                if (value is null)
                    return [segments[0]]; // deleting below something that does not exist
                next = new JsonObject();
                node[segments[i]] = next;
            }
            node = next;
            parents.Add(node);
        }

        var leaf = segments[^1];
        if (value is null)
        {
            node.Remove(leaf);
            // Like the database, an object without children no longer exists.
            for (var i = parents.Count - 1; i > 0 && parents[i].Count == 0; i--)
                parents[i - 1].Remove(segments[i - 1]);
        }
        else
        {
            node[leaf] = value;
        }
        return [segments[0]];
    }
}
