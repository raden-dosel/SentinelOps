FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["SentinelOps.Api/SentinelOps.Api.csproj", "SentinelOps.Api/"]
RUN dotnet restore "SentinelOps.Api/SentinelOps.Api.csproj"

COPY . .
WORKDIR "/src/SentinelOps.Api"
RUN dotnet publish "SentinelOps.Api.csproj" \
    -c Release \
    -o /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "dotnet SentinelOps.Api.dll --urls http://0.0.0.0:${PORT:-8080}"]
