using InteractGuard.Service;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(o => o.ServiceName = "InteractGuard");
builder.Services.AddHostedService<GuardServiceWorker>();
var host = builder.Build();
host.Run();
